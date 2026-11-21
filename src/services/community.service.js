import { prisma } from '../config/db.js';
import { bandOrdinal, isMinorBand, policy, STAFF_ROLES } from '../config/policy.js';
import { requireEnabled } from '../core/settings.js';
import { cursorArgs, cursorResult } from '../core/schemas.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { cleanText } from '../utils/helpers.js';
import { env } from '../config/env.js';
import { assertUsableMedia, mediaUrl } from './media.service.js';
import { blockedIds } from './user.service.js';

const AUTHOR = { select: { id: true, username: true, role: true } };
const MEDIA = { select: { secureUrl: true, status: true } };
const author = (a) => ({ id: a.id, username: a.username, verifiedProfessional: a.role === 'PROFESSIONAL' });

/** Minors and adults use separate community spaces when segregation is on (configurable safeguarding policy). */
function visibility(user) {
  const where = { status: 'PUBLISHED' };
  if (policy.community.segregateMinors && !['ADMIN', 'MODERATOR'].includes(user.role)) where.isMinorSpace = isMinorBand(user.ageBand);
  return where;
}

export async function reactionMap(userId, targetType, ids) {
  if (!ids.length) return new Map();
  const rows = await prisma.reaction.findMany({ where: { userId, targetType, targetId: { in: ids } }, select: { targetId: true, type: true } });
  return new Map(rows.map((r) => [r.targetId, r.type]));
}

const postDto = (p, mine) => ({
  id: p.id,
  text: p.text,
  category: p.category ?? null,
  author: author(p.author),
  mediaUrl: mediaUrl(p.media),
  status: p.status,
  reactionCount: p.reactionCount,
  commentCount: p.commentCount,
  myReaction: mine.get(p.id) ?? null,
  createdAt: p.createdAt,
});
const POST_SELECT = { id: true, text: true, status: true, reactionCount: true, commentCount: true, createdAt: true, author: AUTHOR, category: { select: { slug: true, name: true } }, media: MEDIA };

async function assertCanParticipate(user) {
  await requireEnabled('community_enabled', 'The community');
  if (bandOrdinal(user.ageBand) < bandOrdinal(policy.community.minBandToPost)) throw forbidden('Posting is not available for your age group yet', 'AGE_RESTRICTED');
  if (env.REQUIRE_VERIFIED_FOR_POSTING && !user.verified) throw forbidden('Verify your email or phone before posting', 'VERIFICATION_REQUIRED');
}

export async function listPosts(user, { cursor, limit, categoryId, mine }) {
  const where = mine
    ? { authorId: user.id, status: { not: 'REMOVED' } }
    : { ...visibility(user), ...(categoryId ? { categoryId } : {}), authorId: { notIn: await blockedIds(user.id) } };
  const rows = await prisma.communityPost.findMany({ where, select: POST_SELECT, ...cursorArgs({ cursor, limit }) });
  const { items, meta } = cursorResult(rows, { limit });
  const reacted = await reactionMap(user.id, 'COMMUNITY_POST', items.map((p) => p.id));
  return { items: items.map((p) => postDto(p, reacted)), meta };
}

export async function getPost(user, id) {
  const p = await prisma.communityPost.findFirst({ where: { id, OR: [visibility(user), { authorId: user.id, status: { not: 'REMOVED' } }] }, select: POST_SELECT });
  if (!p) throw notFound('Post not found');
  return postDto(p, await reactionMap(user.id, 'COMMUNITY_POST', [id]));
}

export async function createPost(user, { text, categoryId, mediaId }) {
  await assertCanParticipate(user);
  await assertUsableMedia([mediaId], { ownerId: user.id, purposes: ['COMMUNITY'] });
  const p = await prisma.communityPost.create({
    data: { authorId: user.id, text: cleanText(text), categoryId, mediaId, isMinorSpace: policy.community.segregateMinors && isMinorBand(user.ageBand) },
    select: POST_SELECT,
  });
  return postDto(p, new Map());
}

export async function deletePost(user, id) {
  const r = await prisma.communityPost.updateMany({ where: { id, authorId: user.id, status: { not: 'REMOVED' } }, data: { status: 'REMOVED' } });
  if (!r.count) throw notFound('Post not found');
  return { deleted: true };
}

// ── Comments ────────────────────────────────────────────────────────────────
const commentDto = (c, mine) => ({ id: c.id, postId: c.postId, parentId: c.parentId, text: c.text, author: author(c.author), reactionCount: c.reactionCount, replyCount: c.replyCount, myReaction: mine.get(c.id) ?? null, createdAt: c.createdAt });

async function visiblePost(user, postId) {
  const p = await prisma.communityPost.findFirst({ where: { id: postId, ...visibility(user) }, select: { id: true } });
  if (!p) throw notFound('Post not found');
}

export async function listComments(user, postId, { cursor, limit, parentId }) {
  await visiblePost(user, postId);
  const where = { postId, parentId: parentId ?? null, status: 'PUBLISHED', authorId: { notIn: await blockedIds(user.id) } };
  const rows = await prisma.comment.findMany({ where, include: { author: AUTHOR }, ...cursorArgs({ cursor, limit }, 'asc') });
  const { items, meta } = cursorResult(rows, { limit });
  const reacted = await reactionMap(user.id, 'COMMENT', items.map((c) => c.id));
  return { items: items.map((c) => commentDto(c, reacted)), meta };
}

export async function createComment(user, postId, { text, parentId }) {
  await assertCanParticipate(user);
  await visiblePost(user, postId);
  if (parentId) {
    const parent = await prisma.comment.findFirst({ where: { id: parentId, postId, status: 'PUBLISHED' }, select: { parentId: true } });
    if (!parent) throw notFound('Parent comment not found');
    if (parent.parentId) throw badRequest('Replies can only be one level deep', undefined, 'REPLY_DEPTH');
  }
  const c = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({ data: { postId, authorId: user.id, parentId, text: cleanText(text) }, include: { author: AUTHOR } });
    await tx.communityPost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } });
    if (parentId) await tx.comment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } });
    return created;
  });
  return commentDto(c, new Map());
}

export async function deleteComment(user, id) {
  await prisma.$transaction(async (tx) => {
    const c = await tx.comment.findFirst({ where: { id, authorId: user.id, status: 'PUBLISHED' }, select: { postId: true, parentId: true } });
    if (!c) throw notFound('Comment not found');
    await tx.comment.update({ where: { id }, data: { status: 'REMOVED' } });
    await tx.communityPost.update({ where: { id: c.postId }, data: { commentCount: { decrement: 1 } } });
    if (c.parentId) await tx.comment.update({ where: { id: c.parentId }, data: { replyCount: { decrement: 1 } } });
  });
  return { deleted: true };
}

// ── Reactions ───────────────────────────────────────────────────────────────
const MODEL = { COMMUNITY_POST: 'communityPost', COMMENT: 'comment', CHANNEL_POST: 'channelPost' };

async function assertReactable(user, type, id) {
  const where =
    type === 'COMMUNITY_POST' ? { id, ...visibility(user) }
    : type === 'COMMENT' ? { id, status: 'PUBLISHED', post: visibility(user) }
    : { id, status: 'PUBLISHED', channel: { isActive: true, verificationStatus: 'VERIFIED' } };
  if (!(await prisma[MODEL[type]].findFirst({ where, select: { id: true } }))) throw notFound('Target not found');
}

/** Toggle a reaction: same type again removes it, a different type replaces it. */
export async function toggleReaction(user, { targetType, targetId, type }) {
  await assertReactable(user, targetType, targetId);
  const model = MODEL[targetType];
  return prisma.$transaction(async (tx) => {
    const key = { userId_targetType_targetId: { userId: user.id, targetType, targetId } };
    const existing = await tx.reaction.findUnique({ where: key });
    let delta = 0;
    let reacted = true;
    if (!existing) {
      await tx.reaction.create({ data: { userId: user.id, targetType, targetId, type } });
      delta = 1;
    } else if (existing.type === type) {
      await tx.reaction.delete({ where: key });
      delta = -1;
      reacted = false;
    } else {
      await tx.reaction.update({ where: key, data: { type } });
    }
    const t = delta ? await tx[model].update({ where: { id: targetId }, data: { reactionCount: { increment: delta } }, select: { reactionCount: true } }) : await tx[model].findUnique({ where: { id: targetId }, select: { reactionCount: true } });
    return { reacted, type: reacted ? type : null, reactionCount: t.reactionCount };
  });
}
export { STAFF_ROLES };
