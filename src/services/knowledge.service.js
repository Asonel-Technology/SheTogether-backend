import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { bandOrdinal } from '../config/policy.js';
import { audit } from '../core/audit.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { embed, vectorLiteral } from './ai.js';
import { chunkText } from './chunker.js';
import { createWorkflow } from './workflow.js';

const FIELDS = ['title', 'organization', 'sourceUrl', 'body', 'minAgeBand', 'maxAgeBand'];

/** Chunk + embed (network). Runs before the DB transaction. */
async function prepare(version, language) {
  const chunks = chunkText(version.body);
  if (!chunks.length) throw badRequest('Source has no usable text', undefined, 'EMPTY_SOURCE');
  const vectors = await embed(chunks.map((c) => `${version.title}\n\n${c}`));
  return { chunks, vectors, language };
}

async function insertChunks(tx, version, { chunks, vectors, language }) {
  const ageMin = bandOrdinal(version.minAgeBand);
  const ageMax = bandOrdinal(version.maxAgeBand);
  for (let i = 0; i < chunks.length; i += 40) {
    const rows = chunks.slice(i, i + 40).map(
      (text, j) =>
        Prisma.sql`(${crypto.randomUUID()}, ${version.id}, ${i + j}, ${text}, ${vectorLiteral(vectors[i + j])}::vector, ${language}::"Language", ${ageMin}, ${ageMax}, true)`,
    );
    await tx.$executeRaw`INSERT INTO "knowledge_chunks" ("id","versionId","chunkIndex","chunkText","embedding","language","ageMin","ageMax","active") VALUES ${Prisma.join(rows)}`;
  }
}

export const knowledgeWorkflow = createWorkflow({
  parent: 'knowledgeSource',
  version: 'knowledgeSourceVersion',
  fk: 'sourceId',
  entity: 'knowledge',
  copyFields: FIELDS,
  async beforePublish(v) {
    const s = await prisma.knowledgeSource.findUnique({ where: { id: v.sourceId }, select: { language: true } });
    return prepare(v, s.language);
  },
  onPublished: (tx, v, prepared) => insertChunks(tx, v, prepared),
  // Old chunks are disabled (never silently mixed with the new version).
  onUnpublished: (tx, oldVersionId) => tx.knowledgeChunk.updateMany({ where: { versionId: oldVersionId }, data: { active: false } }),
});

export async function createSource(actor, { language, ...v }) {
  const s = await prisma.knowledgeSource.create({
    data: { language, createdById: actor.id, versions: { create: { ...v, version: 1, createdById: actor.id } } },
    include: { versions: true },
  });
  await audit(actor, 'knowledge.created', 'knowledge', s.id);
  return s;
}

export async function listSources({ status, language, ...pq }) {
  const where = { ...(language ? { language } : {}), ...(status ? { versions: { some: { status } } } : {}) };
  const pg = paginate(pq);
  const [rows, total] = await prisma.$transaction([
    prisma.knowledgeSource.findMany({
      where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take,
      select: { id: true, language: true, publishedVersionId: true, createdAt: true, versions: { where: status ? { status } : undefined, orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, status: true, title: true, organization: true, updatedAt: true } } },
    }),
    prisma.knowledgeSource.count({ where }),
  ]);
  return { items: rows.map(({ versions, ...s }) => ({ ...s, latestVersion: versions[0] ?? null })), meta: pageMeta(total, pg) };
}

export async function getSource(id) {
  const s = await prisma.knowledgeSource.findUnique({ where: { id }, include: { versions: { orderBy: { version: 'desc' }, include: { _count: { select: { chunks: true } } } } } });
  if (!s) throw notFound('Knowledge source not found');
  return s;
}

export const updateVersion = (actor, id, data) => knowledgeWorkflow.updateDraft(id, data, actor);

/** Re-embed the published version (e.g. after changing the embedding model). */
export async function reindex(actor, sourceId) {
  const s = await prisma.knowledgeSource.findUnique({ where: { id: sourceId }, include: { publishedVersion: true } });
  if (!s) throw notFound('Knowledge source not found');
  if (!s.publishedVersion) throw conflict('Nothing is published for this source', 'NOT_PUBLISHED');
  const prepared = await prepare(s.publishedVersion, s.language);
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeChunk.deleteMany({ where: { versionId: s.publishedVersion.id } });
    await insertChunks(tx, s.publishedVersion, prepared);
    await audit(actor, 'knowledge.reindexed', 'knowledge', sourceId, undefined, tx);
  }, { timeout: 20_000 });
  return { reindexed: true, chunks: prepared.chunks.length };
}

/** Vector search restricted to PUBLISHED (active) chunks for the user's language and age band. */
export async function searchChunks({ vector, language, ageBand, k = env.RAG_TOP_K }) {
  const fallback = env.RAG_FALLBACK_LANGUAGE === 'none' ? language : env.RAG_FALLBACK_LANGUAGE;
  const vec = vectorLiteral(vector);
  const ord = bandOrdinal(ageBand);
  const rows = await prisma.$queryRaw`
    SELECT c."id", c."chunkText" AS "text", v."sourceId", v."title", v."organization", v."sourceUrl",
           1 - (c."embedding" <=> ${vec}::vector) AS "similarity"
    FROM "knowledge_chunks" c
    JOIN "knowledge_source_versions" v ON v."id" = c."versionId"
    WHERE c."active" = true
      AND (c."language" = ${language}::"Language" OR c."language" = ${fallback}::"Language")
      AND c."ageMin" <= ${ord} AND c."ageMax" >= ${ord}
    ORDER BY c."embedding" <=> ${vec}::vector
    LIMIT ${k}`;
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

/** Reviewer tool: check WHICH chunks are retrieved for a question (judge retrieval before judging answers). */
export async function retrievalTest({ question, language, ageBand, k }) {
  const [vector] = await embed([question]);
  const hits = await searchChunks({ vector, language, ageBand, k });
  return { threshold: env.RAG_MIN_SIMILARITY, hits: hits.map((h) => ({ ...h, aboveThreshold: h.similarity >= env.RAG_MIN_SIMILARITY })) };
}
