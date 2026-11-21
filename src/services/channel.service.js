import { prisma } from '../config/db.js';
import { audit } from '../core/audit.js';
import { audienceWhere } from '../config/policy.js';
import { cursorArgs, cursorResult, paginate, pageMeta } from '../core/schemas.js';
import { requireEnabled } from '../core/settings.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { cleanText, uniqueSlug, slugify } from '../utils/helpers.js';
import { assertUsableMedia, mediaUrl } from './media.service.js';
import { reactionMap } from './community.service.js';
import { invalidateAuthUser } from '../middleware/auth.js';

const CHANNEL_SELECT = { id: true, name: true, slug: true, description: true, channelType: true, verificationStatus: true, minAgeBand: true, maxAgeBand: true, followersCount: true, owner: { select: { id: true, username: true } } };
const visibleChannel = (user) => ({ isActive: true, verificationStatus: 'VERIFIED', ...audienceWhere(user.ageBand) });
const channelDto = (c, following) => ({ ...c, verified: c.verificationStatus === 'VERIFIED', isFollowing: following?.has(c.id) ?? false });

export async function listChannels(user, { type, ...pq }) {
  const where = { ...visibleChannel(user), ...(type ? { channelType: type } : {}) };
  const pg = paginate(pq);
  const [rows, total] = await prisma.$transaction([
    prisma.channel.findMany({ where, select: CHANNEL_SELECT, orderBy: [{ followersCount: 'desc' }, { id: 'desc' }], skip: pg.skip, take: pg.take }),
    prisma.channel.count({ where }),
  ]);
  const f = await prisma.channelFollow.findMany({ where: { userId: user.id, channelId: { in: rows.map((r) => r.id) } }, select: { channelId: true } });
  const following = new Set(f.map((x) => x.channelId));
  return { items: rows.map((c) => channelDto(c, following)), meta: pageMeta(total, pg) };
}

async function getVisible(user, id) {
  const c = await prisma.channel.findFirst({ where: { id, ...visibleChannel(user) }, select: { ...CHANNEL_SELECT, requiresReview: true, ownerId: true } });
  if (!c) throw notFound('Channel not found');
  return c;
}

export async function getChannel(user, id) {
  const c = await getVisible(user, id);
  const f = await prisma.channelFollow.findUnique({ where: { channelId_userId: { channelId: id, userId: user.id } }, select: { userId: true } });
  const { requiresReview, ownerId, ...pub } = c;
  return channelDto(pub, f ? new Set([id]) : new Set());
}

export async function follow(user, id) {
  await getVisible(user, id);
  await prisma.$transaction(async (tx) => {
    const r = await tx.channelFollow.createMany({ data: [{ channelId: id, userId: user.id }], skipDuplicates: true });
    if (r.count) await tx.channel.update({ where: { id }, data: { followersCount: { increment: 1 } } });
  });
  return { following: true };
}
export async function unfollow(user, id) {
  await prisma.$transaction(async (tx) => {
    const r = await tx.channelFollow.deleteMany({ where: { channelId: id, userId: user.id } });
    if (r.count) await tx.channel.update({ where: { id }, data: { followersCount: { decrement: 1 } } });
  });
  return { following: false };
}

const postDto = (p, mine) => ({ id: p.id, channelId: p.channelId, text: p.text, mediaUrl: mediaUrl(p.media), status: p.status, reactionCount: p.reactionCount, myReaction: mine.get(p.id) ?? null, publishedAt: p.publishedAt, createdAt: p.createdAt });
const POST_SELECT = { id: true, channelId: true, text: true, status: true, reactionCount: true, publishedAt: true, createdAt: true, media: { select: { secureUrl: true, status: true } } };
const canManage = (user, channel) => user.role === 'ADMIN' || (user.role === 'PROFESSIONAL' && channel.ownerId === user.id);

export async function listPosts(user, channelId, { cursor, limit, status }) {
  const c = await getVisible(user, channelId);
  const where = { channelId, status: status && canManage(user, c) ? status : 'PUBLISHED' };
  const rows = await prisma.channelPost.findMany({ where, select: POST_SELECT, ...cursorArgs({ cursor, limit }) });
  const { items, meta } = cursorResult(rows, { limit });
  const mine = await reactionMap(user.id, 'CHANNEL_POST', items.map((p) => p.id));
  return { items: items.map((p) => postDto(p, mine)), meta };
}

export async function createPost(user, channelId, { text, mediaId }) {
  const c = await getVisible(user, channelId);
  if (!canManage(user, c)) throw forbidden('Only the verified owner of this channel can post');
  await assertUsableMedia([mediaId], { ownerId: user.id, purposes: ['CHANNEL_POST'] });
  const needsReview = c.requiresReview && user.role !== 'ADMIN';
  const p = await prisma.channelPost.create({
    data: { channelId, authorId: user.id, text: cleanText(text), mediaId, status: needsReview ? 'PENDING_REVIEW' : 'PUBLISHED', publishedAt: needsReview ? null : new Date() },
    select: POST_SELECT,
  });
  return postDto(p, new Map());
}

export async function updatePost(user, id, { text, mediaId }) {
  const p = await prisma.channelPost.findUnique({ where: { id }, select: { authorId: true, status: true, channel: { select: { requiresReview: true } } } });
  if (!p || p.status === 'REMOVED') throw notFound('Post not found');
  if (p.authorId !== user.id && user.role !== 'ADMIN') throw forbidden();
  await assertUsableMedia([mediaId], { ownerId: p.authorId, purposes: ['CHANNEL_POST'] });
  const needsReview = p.channel.requiresReview && user.role !== 'ADMIN'; // edits to reviewed posts are reviewed again
  const updated = await prisma.channelPost.update({ where: { id }, data: { ...(text ? { text: cleanText(text) } : {}), ...(mediaId !== undefined ? { mediaId } : {}), ...(needsReview ? { status: 'PENDING_REVIEW', publishedAt: null } : {}) }, select: POST_SELECT });
  return postDto(updated, new Map());
}

export async function deletePost(user, id) {
  const r = await prisma.channelPost.updateMany({ where: { id, status: { not: 'REMOVED' }, ...(user.role === 'ADMIN' ? {} : { authorId: user.id }) }, data: { status: 'REMOVED' } });
  if (!r.count) throw notFound('Post not found');
  return { deleted: true };
}

// ── Admin / review ──────────────────────────────────────────────────────────
export async function listPendingPosts({ status, ...pq }) {
  const where = { status: status ?? 'PENDING_REVIEW' };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.channelPost.findMany({ where, orderBy: { id: 'asc' }, skip: pg.skip, take: pg.take, select: { ...POST_SELECT, authorId: true, reviewNote: true, channel: { select: { id: true, name: true } } } }),
    prisma.channelPost.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}

export async function reviewPost(reviewer, id, { decision, note }) {
  const now = new Date();
  const r = await prisma.channelPost.updateMany({
    where: { id, status: 'PENDING_REVIEW' },
    data: decision === 'APPROVED' ? { status: 'PUBLISHED', publishedAt: now, reviewedById: reviewer.id, reviewedAt: now, reviewNote: note ?? null } : { status: 'REJECTED', reviewedById: reviewer.id, reviewedAt: now, reviewNote: note },
  });
  if (!r.count) throw conflict('Post is not awaiting review', 'INVALID_STATE');
  await audit(reviewer, `channel_post.${decision.toLowerCase()}`, 'channel_post', id, { note });
  return { id, decision };
}

export async function listAdminChannels(pq) {
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([prisma.channel.findMany({ orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take, include: { owner: { select: { id: true, username: true } } } }), prisma.channel.count()]);
  return { items, meta: pageMeta(total, pg) };
}

async function assertOwner(ownerId) {
  if (!ownerId) return;
  const u = await prisma.user.findUnique({ where: { id: ownerId }, select: { role: true } });
  if (!u) throw notFound('Owner not found');
  if (!['PROFESSIONAL', 'ADMIN'].includes(u.role)) throw badRequest('Channel owner must be a verified professional or an administrator', undefined, 'INVALID_OWNER');
}

export async function createChannel(actor, data) {
  await assertOwner(data.ownerId);
  try {
    const c = await prisma.channel.create({ data: { ...data, slug: data.slug ? slugify(data.slug) : uniqueSlug(data.name) } });
    await audit(actor, 'channel.created', 'channel', c.id);
    return c;
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Slug already in use', 'SLUG_TAKEN');
    throw e;
  }
}
export async function updateChannel(actor, id, data) {
  await assertOwner(data.ownerId);
  const c = await prisma.channel.update({ where: { id }, data });
  await audit(actor, 'channel.updated', 'channel', id, data);
  return c;
}

// ── Professional applications ───────────────────────────────────────────────
export async function applyAsProfessional(user, data) {
  if (['PROFESSIONAL', 'ADMIN', 'MODERATOR', 'CONTENT_REVIEWER'].includes(user.role)) throw conflict('Your account already has an elevated role', 'ALREADY_PROFESSIONAL');
  if (await prisma.professionalApplication.findFirst({ where: { userId: user.id, status: 'PENDING' }, select: { id: true } })) throw conflict('You already have a pending application', 'APPLICATION_PENDING');
  return prisma.professionalApplication.create({ data: { ...data, userId: user.id }, select: { id: true, status: true, createdAt: true } });
}
export const myApplications = (userId) => prisma.professionalApplication.findMany({ where: { userId }, orderBy: { id: 'desc' }, take: 10, select: { id: true, organizationName: true, professionalTitle: true, status: true, reviewNote: true, createdAt: true, decidedAt: true } });

export async function listApplications({ status, ...pq }) {
  const where = { status: status ?? 'PENDING' };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.professionalApplication.findMany({ where, orderBy: { id: 'asc' }, skip: pg.skip, take: pg.take, include: { user: { select: { id: true, username: true, email: true, phone: true } } } }),
    prisma.professionalApplication.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}

/** Admin-only: roles/badges are never self-assigned. Approval promotes the user and may assign a channel. */
export async function decideApplication(admin, id, { decision, note, channelId }) {
  const app = await prisma.professionalApplication.findUnique({ where: { id } });
  if (!app) throw notFound('Application not found');
  if (app.status !== 'PENDING') throw conflict('Application already decided', 'INVALID_STATE');
  await prisma.$transaction(async (tx) => {
    await tx.professionalApplication.update({ where: { id }, data: { status: decision, reviewerId: admin.id, reviewNote: note ?? null, decidedAt: new Date() } });
    if (decision === 'APPROVED') {
      await tx.user.updateMany({ where: { id: app.userId, role: 'USER' }, data: { role: 'PROFESSIONAL' } });
      if (channelId) await tx.channel.update({ where: { id: channelId }, data: { ownerId: app.userId } });
    }
    await audit(admin, `professional_application.${decision.toLowerCase()}`, 'user', app.userId, { applicationId: id }, tx);
  });
  invalidateAuthUser(app.userId);
  return { id, decision };
}
