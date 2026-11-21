import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { policy, STAFF_ROLES } from '../config/policy.js';
import { revokeAllSessions } from '../core/tokens.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { invalidateAuthUser } from '../middleware/auth.js';

const CONTENT = { COMMUNITY_POST: 'communityPost', COMMENT: 'comment', CHANNEL_POST: 'channelPost' };
const USER_ACTIONS = ['WARN', 'SUSPEND', 'UNSUSPEND', 'BAN'];

/** Load whatever a report/action points at. */
export async function getTarget(type, id) {
  let t;
  if (type === 'USER') {
    const u = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true, status: true } });
    t = u && { authorId: u.id, status: u.status, role: u.role, snapshot: { username: u.username } };
  } else if (type === 'COMMENT') {
    const c = await prisma.comment.findUnique({ where: { id }, select: { authorId: true, status: true, text: true, postId: true } });
    t = c && { authorId: c.authorId, status: c.status, snapshot: { text: c.text, postId: c.postId } };
  } else {
    const model = CONTENT[type];
    const c = await prisma[model].findUnique({ where: { id }, select: { authorId: true, status: true, text: true, mediaId: true } });
    t = c && { authorId: c.authorId, status: c.status, mediaId: c.mediaId, snapshot: { text: c.text } };
  }
  if (!t) throw notFound('Target not found');
  return t;
}

async function setCommentStatus(tx, id, status) {
  const c = await tx.comment.findUnique({ where: { id }, select: { status: true, postId: true, parentId: true } });
  await tx.comment.update({ where: { id }, data: { status } });
  const wasLive = c.status === 'PUBLISHED';
  const isLive = status === 'PUBLISHED';
  if (wasLive !== isLive) {
    const d = isLive ? 1 : -1;
    await tx.communityPost.update({ where: { id: c.postId }, data: { commentCount: { increment: d } } });
    if (c.parentId) await tx.comment.update({ where: { id: c.parentId }, data: { replyCount: { increment: d } } });
  }
}

/**
 * Apply a moderation action atomically and log it with its reason.
 * `actor` is null for automatic actions (auto-hide after reports).
 */
export async function applyAction({ actor, targetType, targetId, action, reason, suspendDays, reportId }) {
  const isUserAction = USER_ACTIONS.includes(action);
  if (isUserAction && targetType !== 'USER') throw badRequest(`${action} must target a USER`, undefined, 'INVALID_TARGET');
  if (!isUserAction && ['HIDE', 'REMOVE', 'RESTORE'].includes(action) && targetType === 'USER') throw badRequest(`${action} must target content`, undefined, 'INVALID_TARGET');
  if (action === 'BAN' && actor?.role !== 'ADMIN') throw forbidden('Only administrators can ban users');
  if (action === 'SUSPEND' && !suspendDays) throw badRequest('suspendDays is required', undefined, 'VALIDATION_ERROR');

  const target = await getTarget(targetType, targetId);
  if (isUserAction) {
    if (actor && targetId === actor.id) throw forbidden('You cannot moderate yourself');
    if (STAFF_ROLES.includes(target.role) && actor?.role !== 'ADMIN') throw forbidden('Only administrators can act on staff accounts');
  }

  const result = await prisma.$transaction(async (tx) => {
    switch (action) {
      case 'HIDE':
      case 'REMOVE':
      case 'RESTORE': {
        const status = action === 'HIDE' ? 'HIDDEN' : action === 'REMOVE' ? 'REMOVED' : 'PUBLISHED';
        if (targetType === 'COMMENT') await setCommentStatus(tx, targetId, status);
        else await tx[CONTENT[targetType]].update({ where: { id: targetId }, data: { status, ...(status === 'PUBLISHED' && targetType === 'CHANNEL_POST' ? { publishedAt: new Date() } : {}) } });
        if (target.mediaId && action !== 'HIDE') await tx.mediaAsset.update({ where: { id: target.mediaId }, data: { status: action === 'REMOVE' ? 'DISABLED' : 'ACTIVE' } });
        break;
      }
      case 'SUSPEND':
        await tx.user.update({ where: { id: targetId }, data: { status: 'SUSPENDED', suspendedUntil: new Date(Date.now() + suspendDays * 86_400_000) } });
        await revokeAllSessions(targetId, tx);
        break;
      case 'UNSUSPEND': {
        const r = await tx.user.updateMany({ where: { id: targetId, status: 'SUSPENDED' }, data: { status: 'ACTIVE', suspendedUntil: null } });
        if (!r.count) throw conflict('User is not suspended', 'NOT_SUSPENDED');
        break;
      }
      case 'BAN':
        await tx.user.update({ where: { id: targetId }, data: { status: 'BANNED' } });
        await revokeAllSessions(targetId, tx);
        break;
      default: // WARN, ESCALATE, DISMISS: logged only
        break;
    }
    const log = await tx.moderationAction.create({ data: { moderatorId: actor?.id ?? null, targetType, targetId, action, reason, metadata: suspendDays ? { suspendDays } : undefined } });

    const reportStatus = action === 'DISMISS' ? 'DISMISSED' : action === 'ESCALATE' ? 'ESCALATED' : 'RESOLVED';
    if (reportId) {
      await tx.report.update({ where: { id: reportId }, data: { status: reportStatus, moderatorId: actor?.id ?? null, resolution: reason, resolvedAt: new Date() } });
    }
    if (['HIDE', 'REMOVE'].includes(action)) {
      await tx.report.updateMany({ where: { targetType, targetId, status: 'OPEN' }, data: { status: 'RESOLVED', moderatorId: actor?.id ?? null, resolution: reason, resolvedAt: new Date() } });
    }
    return log;
  });
  if (isUserAction) invalidateAuthUser(targetId);
  return result;
}

// ── Reports ─────────────────────────────────────────────────────────────────
export async function createReport(user, { targetType, targetId, reason, details }) {
  const target = await getTarget(targetType, targetId);
  if (target.authorId === user.id) throw badRequest('You cannot report your own content', undefined, 'INVALID_TARGET');
  try {
    await prisma.report.create({ data: { reporterId: user.id, targetType, targetId, reason, details } });
  } catch (e) {
    if (e.code === 'P2002') throw conflict('You already reported this', 'ALREADY_REPORTED');
    throw e;
  }
  // Auto-hide pending review once several different people report the same content.
  if (['COMMUNITY_POST', 'COMMENT'].includes(targetType) && target.status === 'PUBLISHED') {
    const open = await prisma.report.count({ where: { targetType, targetId, status: { in: ['OPEN', 'ESCALATED'] } } });
    if (open >= policy.community.autoHideThreshold) {
      await applyAction({ actor: null, targetType, targetId, action: 'HIDE', reason: `Automatically hidden pending review after ${open} reports` }).catch(() => {});
    }
  }
  return { reported: true };
}

export async function listReports({ status, targetType, ...pq }) {
  const where = { ...(status ? { status } : { status: { in: ['OPEN', 'ESCALATED'] } }), ...(targetType ? { targetType } : {}) };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.report.findMany({ where, orderBy: { id: 'asc' }, skip: pg.skip, take: pg.take, select: { id: true, targetType: true, targetId: true, reason: true, details: true, status: true, createdAt: true } }),
    prisma.report.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}

export async function getReport(id) {
  const r = await prisma.report.findUnique({ where: { id }, select: { id: true, targetType: true, targetId: true, reason: true, details: true, status: true, resolution: true, createdAt: true, resolvedAt: true } });
  if (!r) throw notFound('Report not found');
  const [target, history, reportCount] = await Promise.all([
    getTarget(r.targetType, r.targetId).catch(() => null),
    prisma.moderationAction.findMany({ where: { targetType: r.targetType, targetId: r.targetId }, orderBy: { id: 'desc' }, take: 20 }),
    prisma.report.count({ where: { targetType: r.targetType, targetId: r.targetId } }),
  ]);
  return { ...r, reportCount, target, history };
}

/** Resolve a report. *_AUTHOR actions act on the owner of the reported content. */
export async function resolveReport(actor, id, { action, reason, suspendDays }) {
  const r = await prisma.report.findUnique({ where: { id } });
  if (!r) throw notFound('Report not found');
  if (['RESOLVED', 'DISMISSED'].includes(r.status)) throw conflict('Report is already closed', 'ALREADY_CLOSED');
  const userLevel = action.endsWith('_AUTHOR');
  const base = action.replace('_AUTHOR', '');
  const target = userLevel ? await getTarget(r.targetType, r.targetId) : null;
  return applyAction({
    actor,
    targetType: userLevel ? 'USER' : r.targetType,
    targetId: userLevel ? target.authorId : r.targetId,
    action: base,
    reason,
    suspendDays,
    reportId: id,
  });
}

export async function listActions({ targetType, targetId, ...pq }) {
  const where = { ...(targetType ? { targetType } : {}), ...(targetId ? { targetId } : {}) };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.moderationAction.findMany({ where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.moderationAction.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}
export { env };
