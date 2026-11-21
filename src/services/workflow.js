import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { audit } from '../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

const OPEN = ['DRAFT', 'IN_REVIEW', 'REJECTED'];

/**
 * Draft → In review → Published → Archived workflow shared by articles and chatbot knowledge.
 * Published versions are immutable: edits always create a NEW draft version that must be re-reviewed,
 * and the live version keeps serving until the new one is approved.
 */
export function createWorkflow({ parent, version, fk, entity, copyFields, beforePublish, onPublished, onUnpublished }) {
  const P = () => prisma[parent];
  const V = () => prisma[version];

  async function loadVersion(id) {
    const v = await V().findUnique({ where: { id } });
    if (!v) throw notFound(`${entity} version not found`);
    return v;
  }

  async function createDraft(parentId, actor, overrides = {}) {
    if (!(await P().findUnique({ where: { id: parentId }, select: { id: true } }))) throw notFound(`${entity} not found`);
    const open = await V().findFirst({ where: { [fk]: parentId, status: { in: OPEN } }, select: { id: true, status: true } });
    if (open) throw conflict(`An unpublished version already exists (${open.status}). Edit or submit it first.`, 'OPEN_VERSION_EXISTS');
    const latest = await V().findFirst({ where: { [fk]: parentId }, orderBy: { version: 'desc' } });
    const base = Object.fromEntries(copyFields.map((f) => [f, latest[f]]));
    const created = await V().create({
      data: { ...base, ...overrides, [fk]: parentId, version: latest.version + 1, createdById: actor.id, status: 'DRAFT' },
    });
    await audit(actor, `${entity}.version_created`, entity, parentId, { versionId: created.id, version: created.version });
    return created;
  }

  async function updateDraft(versionId, data, actor) {
    const v = await loadVersion(versionId);
    if (!['DRAFT', 'REJECTED'].includes(v.status)) throw conflict('Only drafts can be edited. Published content is immutable — create a new version instead.', 'NOT_EDITABLE');
    const merged = { ...v, ...data };
    if (merged.minAgeBand && merged.maxAgeBand) {
      const order = ['AGE_10_12', 'AGE_13_15', 'AGE_16_17', 'AGE_18_24', 'AGE_25_35'];
      if (order.indexOf(merged.minAgeBand) > order.indexOf(merged.maxAgeBand)) throw badRequest('minAgeBand must not be older than maxAgeBand');
    }
    return V().update({ where: { id: versionId }, data: { ...data, status: 'DRAFT', reviewerId: null, reviewedAt: null, reviewNote: null } });
  }

  async function submit(versionId, actor) {
    const r = await V().updateMany({ where: { id: versionId, status: { in: ['DRAFT', 'REJECTED'] } }, data: { status: 'IN_REVIEW' } });
    if (!r.count) {
      await loadVersion(versionId);
      throw conflict('Only draft versions can be submitted for review', 'INVALID_STATE');
    }
    await audit(actor, `${entity}.submitted`, entity, versionId);
    return loadVersion(versionId);
  }

  async function approve(versionId, reviewer, note) {
    const v = await loadVersion(versionId);
    if (v.status !== 'IN_REVIEW') throw conflict('Only versions in review can be approved', 'INVALID_STATE');
    if (v.createdById === reviewer.id && !env.ALLOW_SELF_APPROVAL) throw forbidden('A different reviewer must approve this version', 'SELF_APPROVAL_FORBIDDEN');

    // Slow/network work (e.g. embeddings) happens BEFORE the transaction so no DB connection is held while waiting.
    const prepared = beforePublish ? await beforePublish(v) : undefined;

    return prisma.$transaction(async (tx) => {
      const now = new Date();
      const claimed = await tx[version].updateMany({
        where: { id: versionId, status: 'IN_REVIEW' },
        data: { status: 'PUBLISHED', reviewerId: reviewer.id, reviewedAt: now, reviewNote: note ?? null, publishedAt: now, ...(entity === 'knowledge' ? { approvedAt: now } : {}) },
      });
      if (claimed.count !== 1) throw conflict('Version is no longer in review', 'INVALID_STATE');

      const p = await tx[parent].findUnique({ where: { id: v[fk] }, select: { publishedVersionId: true } });
      if (p.publishedVersionId && p.publishedVersionId !== versionId) {
        await tx[version].update({ where: { id: p.publishedVersionId }, data: { status: 'ARCHIVED' } });
        if (onUnpublished) await onUnpublished(tx, p.publishedVersionId);
      }
      await tx[parent].update({ where: { id: v[fk] }, data: { publishedVersionId: versionId } });
      if (onPublished) await onPublished(tx, v, prepared);
      await audit(reviewer, `${entity}.approved`, entity, v[fk], { versionId, version: v.version }, tx);
      return tx[version].findUnique({ where: { id: versionId } });
    }, { timeout: 20_000 });
  }

  async function reject(versionId, reviewer, note) {
    const r = await V().updateMany({
      where: { id: versionId, status: 'IN_REVIEW' },
      data: { status: 'REJECTED', reviewerId: reviewer.id, reviewedAt: new Date(), reviewNote: note },
    });
    if (!r.count) {
      await loadVersion(versionId);
      throw conflict('Only versions in review can be rejected', 'INVALID_STATE');
    }
    await audit(reviewer, `${entity}.rejected`, entity, versionId, { note });
    return loadVersion(versionId);
  }

  async function unpublish(parentId, actor) {
    const p = await P().findUnique({ where: { id: parentId }, select: { publishedVersionId: true } });
    if (!p) throw notFound(`${entity} not found`);
    if (!p.publishedVersionId) throw conflict('Nothing is published', 'NOT_PUBLISHED');
    await prisma.$transaction(async (tx) => {
      await tx[version].update({ where: { id: p.publishedVersionId }, data: { status: 'ARCHIVED' } });
      await tx[parent].update({ where: { id: parentId }, data: { publishedVersionId: null } });
      if (onUnpublished) await onUnpublished(tx, p.publishedVersionId);
      await audit(actor, `${entity}.unpublished`, entity, parentId, undefined, tx);
    });
    return { unpublished: true };
  }

  return { createDraft, updateDraft, submit, approve, reject, unpublish };
}
