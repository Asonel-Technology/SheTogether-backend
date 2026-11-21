import { prisma } from '../config/db.js';
import { audit } from '../core/audit.js';
import { audienceFor } from '../config/policy.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { TtlCache } from '../utils/cache.js';
import { conflict, notFound } from '../utils/errors.js';
import { uniqueSlug, slugify } from '../utils/helpers.js';
import { assertUsableMedia, mediaUrl } from './media.service.js';
import { createWorkflow } from './workflow.js';

// ── Shapes ──────────────────────────────────────────────────────────────────
const MEDIA_SEL = { select: { secureUrl: true, status: true } };
const CARD_SELECT = {
  id: true,
  slug: true,
  language: true,
  isFeatured: true,
  category: { select: { slug: true, name: true } },
  publishedVersion: {
    select: { version: true, title: true, summary: true, publishedAt: true, coverMedia: MEDIA_SEL, audioMedia: MEDIA_SEL },
  },
};
const card = (a) => ({
  id: a.id,
  slug: a.slug,
  language: a.language,
  category: a.category,
  isFeatured: a.isFeatured,
  title: a.publishedVersion.title,
  summary: a.publishedVersion.summary,
  version: a.publishedVersion.version,
  publishedAt: a.publishedVersion.publishedAt,
  coverUrl: mediaUrl(a.publishedVersion.coverMedia),
  audioUrl: mediaUrl(a.publishedVersion.audioMedia),
});

/** Server-side age + language gate. Anonymous visitors only see all-ages content. */
function publicWhere(user, { language, category, q } = {}) {
  const v = { ...audienceFor(user) };
  if (q) v.OR = [{ title: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }];
  return { language: language ?? user?.preferredLanguage ?? 'en', ...(category ? { category: { slug: category } } : {}), publishedVersion: v };
}

// ── Categories (cached; same for everyone) ─────────────────────────────────
const catCache = new TtlCache(300_000, 1);
export async function listCategories() {
  return (
    catCache.get('c') ??
    catCache.set('c', await prisma.contentCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, slug: true, name: true, description: true } }))
  );
}

// ── Public reads ────────────────────────────────────────────────────────────
export async function listArticles(user, query) {
  const where = publicWhere(user, query);
  const pg = paginate(query);
  const [rows, total] = await prisma.$transaction([
    prisma.article.findMany({ where, select: CARD_SELECT, orderBy: { publishedVersion: { publishedAt: 'desc' } }, skip: pg.skip, take: pg.take }),
    prisma.article.count({ where }),
  ]);
  return { items: rows.map(card), meta: pageMeta(total, pg) };
}

export async function home(user, { language }) {
  const base = publicWhere(user, { language });
  const [featured, latest, counts, categories] = await Promise.all([
    prisma.article.findMany({ where: { ...base, isFeatured: true }, select: CARD_SELECT, orderBy: { publishedVersion: { publishedAt: 'desc' } }, take: 5 }),
    prisma.article.findMany({ where: base, select: CARD_SELECT, orderBy: { publishedVersion: { publishedAt: 'desc' } }, take: 8 }),
    prisma.article.groupBy({ by: ['categoryId'], where: base, _count: { _all: true } }),
    listCategories(),
  ]);
  const byCat = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return {
    language: base.language,
    featured: featured.map(card),
    latest: latest.map(card),
    categories: categories.map((c) => ({ ...c, articleCount: byCat.get(c.id) ?? 0 })).filter((c) => c.articleCount > 0),
  };
}

export async function getArticle(user, slug) {
  const a = await prisma.article.findFirst({
    where: { slug, publishedVersion: audienceFor(user) },
    select: { ...CARD_SELECT, id: true, translationKey: true, publishedVersion: { select: { ...CARD_SELECT.publishedVersion.select, body: true, minAgeBand: true, maxAgeBand: true } } },
  });
  if (!a) throw notFound('Article not found');
  const [translations, saved] = await Promise.all([
    a.translationKey
      ? prisma.article.findMany({ where: { translationKey: a.translationKey, id: { not: a.id }, publishedVersion: audienceFor(user) }, select: { slug: true, language: true } })
      : [],
    user ? prisma.savedArticle.findUnique({ where: { userId_articleId: { userId: user.id, articleId: a.id } }, select: { userId: true } }) : null,
  ]);
  return { ...card(a), body: a.publishedVersion.body, audience: { min: a.publishedVersion.minAgeBand, max: a.publishedVersion.maxAgeBand }, translations, saved: Boolean(saved) };
}

/** Bundle of approved articles flagged for offline use (PWA cache). `updatedSince` enables incremental sync. */
export async function offlineBundle(user, { language, updatedSince }) {
  const where = { ...publicWhere(user, { language }), offlineEligible: true };
  if (updatedSince) where.publishedVersion = { ...where.publishedVersion, publishedAt: { gt: updatedSince } };
  const rows = await prisma.article.findMany({
    where,
    select: { ...CARD_SELECT, publishedVersion: { select: { ...CARD_SELECT.publishedVersion.select, body: true } } },
    orderBy: { publishedVersion: { publishedAt: 'desc' } },
    take: 100,
  });
  return rows.map((a) => ({ ...card(a), body: a.publishedVersion.body }));
}

async function accessibleArticleId(user, slug) {
  const a = await prisma.article.findFirst({ where: { slug, publishedVersion: audienceFor(user) }, select: { id: true } });
  if (!a) throw notFound('Article not found');
  return a.id;
}
export async function saveArticle(user, slug) {
  const articleId = await accessibleArticleId(user, slug);
  await prisma.savedArticle.upsert({ where: { userId_articleId: { userId: user.id, articleId } }, create: { userId: user.id, articleId }, update: {} });
  return { saved: true };
}
export async function unsaveArticle(user, slug) {
  const a = await prisma.article.findUnique({ where: { slug }, select: { id: true } });
  if (a) await prisma.savedArticle.deleteMany({ where: { userId: user.id, articleId: a.id } });
  return { saved: false };
}
export async function listSaved(user, query) {
  const where = { userId: user.id, article: { publishedVersion: audienceFor(user) } };
  const pg = paginate(query);
  const [rows, total] = await prisma.$transaction([
    prisma.savedArticle.findMany({ where, orderBy: { createdAt: 'desc' }, skip: pg.skip, take: pg.take, select: { article: { select: CARD_SELECT } } }),
    prisma.savedArticle.count({ where }),
  ]);
  return { items: rows.map((r) => card(r.article)), meta: pageMeta(total, pg) };
}

// ── Admin: categories ───────────────────────────────────────────────────────
export async function createCategory(actor, data) {
  const c = await prisma.contentCategory.create({ data });
  catCache.clear();
  await audit(actor, 'category.created', 'category', c.id);
  return c;
}
export async function updateCategory(actor, id, data) {
  const c = await prisma.contentCategory.update({ where: { id }, data });
  catCache.clear();
  await audit(actor, 'category.updated', 'category', id);
  return c;
}
export async function deleteCategory(actor, id) {
  if (await prisma.article.count({ where: { categoryId: id } })) throw conflict('Category still has articles', 'CATEGORY_IN_USE');
  await prisma.contentCategory.delete({ where: { id } });
  catCache.clear();
  await audit(actor, 'category.deleted', 'category', id);
  return { deleted: true };
}

// ── Admin: articles & versions ──────────────────────────────────────────────
const VERSION_FIELDS = ['title', 'summary', 'body', 'ussdSummary', 'minAgeBand', 'maxAgeBand', 'coverMediaId', 'audioMediaId'];
export const articleWorkflow = createWorkflow({ parent: 'article', version: 'articleVersion', fk: 'articleId', entity: 'article', copyFields: VERSION_FIELDS });

export async function createArticle(actor, input) {
  const { slug, language, categoryId, translationKey, isFeatured, offlineEligible, ...v } = input;
  await assertUsableMedia([v.coverMediaId, v.audioMediaId]);
  const finalSlug = slug ?? uniqueSlug(v.title);
  try {
    const a = await prisma.article.create({
      data: { slug: finalSlug, language, categoryId, translationKey, isFeatured, offlineEligible, createdById: actor.id, versions: { create: { ...v, version: 1, createdById: actor.id } } },
      include: { versions: true },
    });
    await audit(actor, 'article.created', 'article', a.id);
    return a;
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Slug already in use', 'SLUG_TAKEN');
    throw e;
  }
}

export async function updateArticleMeta(actor, id, data) {
  try {
    const a = await prisma.article.update({ where: { id }, data: { ...data, ...(data.slug ? { slug: slugify(data.slug) } : {}) } });
    await audit(actor, 'article.meta_updated', 'article', id, data);
    return a;
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Slug already in use', 'SLUG_TAKEN');
    throw e;
  }
}

export async function listAdminArticles({ status, language, categoryId, q, ...pq }) {
  const where = {
    ...(language ? { language } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { versions: { some: { status } } } : {}),
    ...(q ? { OR: [{ slug: { contains: q, mode: 'insensitive' } }, { versions: { some: { title: { contains: q, mode: 'insensitive' } } } }] } : {}),
  };
  const pg = paginate(pq);
  const [rows, total] = await prisma.$transaction([
    prisma.article.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: pg.skip,
      take: pg.take,
      select: {
        id: true, slug: true, language: true, isFeatured: true, offlineEligible: true, publishedVersionId: true, createdAt: true,
        category: { select: { slug: true, name: true } },
        versions: { where: status ? { status } : undefined, orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true, status: true, title: true, updatedAt: true } },
      },
    }),
    prisma.article.count({ where }),
  ]);
  return { items: rows.map(({ versions, ...a }) => ({ ...a, latestVersion: versions[0] ?? null })), meta: pageMeta(total, pg) };
}

export async function getAdminArticle(id) {
  const a = await prisma.article.findUnique({ where: { id }, include: { category: { select: { slug: true, name: true } }, versions: { orderBy: { version: 'desc' } } } });
  if (!a) throw notFound('Article not found');
  return a;
}

export async function updateArticleVersion(actor, versionId, data) {
  await assertUsableMedia([data.coverMediaId, data.audioMediaId]);
  return articleWorkflow.updateDraft(versionId, data, actor);
}

export async function deleteArticle(actor, id) {
  const a = await prisma.article.findUnique({ where: { id }, select: { publishedVersionId: true } });
  if (!a) throw notFound('Article not found');
  if (a.publishedVersionId) throw conflict('Unpublish the article before deleting it', 'STILL_PUBLISHED');
  await prisma.article.delete({ where: { id } });
  await audit(actor, 'article.deleted', 'article', id);
  return { deleted: true };
}
