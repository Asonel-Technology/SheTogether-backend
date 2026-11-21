import bcrypt from 'bcrypt';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { bandOrdinal } from '../config/policy.js';
import { badRequest, conflict, notFound, unauthorized } from '../utils/errors.js';
import { addDays } from '../utils/helpers.js';
import { bandFromInput } from './auth.service.js';
import { invalidateAuthUser } from '../middleware/auth.js';
import { toUserDto } from './user.dto.js';

export const PREF_DEFAULTS = { fontScale: 100, highContrast: false, reduceMotion: false, ttsEnabled: false, lowDataMode: false, screenReaderOptimized: false };
const prefDto = (p) => ({ ...PREF_DEFAULTS, ...(p ?? {}), userId: undefined });

export async function getMe(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { preferences: true } });
  return { ...toUserDto(u), deletionRequestedAt: u.deletionRequestedAt, preferences: prefDto(u.preferences) };
}

export async function updateMe(userId, data) {
  try {
    const u = await prisma.user.update({ where: { id: userId }, data });
    invalidateAuthUser(userId);
    return toUserDto(u);
  } catch (e) {
    if (e.code === 'P2002') throw conflict('Username is already taken', 'USERNAME_TAKEN');
    throw e;
  }
}

/** Age bands may only move forward: users cannot "become younger" to get around under-18 safeguards. */
export async function updateAge(user, input) {
  const band = bandFromInput(input);
  if (bandOrdinal(band) < bandOrdinal(user.ageBand)) {
    throw conflict('Age group cannot be moved to a younger band. Contact support if this is a mistake.', 'AGE_BAND_DOWNGRADE');
  }
  const u = await prisma.user.update({ where: { id: user.id }, data: { ageBand: band } });
  invalidateAuthUser(user.id);
  return toUserDto(u);
}

export async function getPreferences(userId) {
  return prefDto(await prisma.userPreference.findUnique({ where: { userId } }));
}
export async function setPreferences(userId, data) {
  const p = await prisma.userPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return prefDto(p);
}

export async function requestDeletion(userId, password) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!(await bcrypt.compare(password, u.passwordHash))) throw unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
  if (u.status === 'PENDING_DELETION') throw conflict('Deletion already requested', 'ALREADY_REQUESTED');
  await prisma.user.update({ where: { id: userId }, data: { status: 'PENDING_DELETION', deletionRequestedAt: new Date() } });
  invalidateAuthUser(userId);
  return { status: 'PENDING_DELETION', deletionScheduledFor: addDays(new Date(), env.ACCOUNT_DELETION_GRACE_DAYS) };
}

export async function cancelDeletion(userId) {
  const r = await prisma.user.updateMany({ where: { id: userId, status: 'PENDING_DELETION' }, data: { status: 'ACTIVE', deletionRequestedAt: null } });
  if (!r.count) throw badRequest('No pending deletion request', undefined, 'NOT_PENDING');
  invalidateAuthUser(userId);
  return { status: 'ACTIVE' };
}

export const listBlocks = async (userId) =>
  (await prisma.userBlock.findMany({ where: { blockerId: userId }, select: { createdAt: true, blocked: { select: { id: true, username: true } } }, orderBy: { createdAt: 'desc' }, take: 200 })).map((b) => ({
    userId: b.blocked.id,
    username: b.blocked.username,
    blockedAt: b.createdAt,
  }));

export async function blockUser(userId, targetId) {
  if (userId === targetId) throw badRequest('You cannot block yourself', undefined, 'INVALID_TARGET');
  const t = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!t) throw notFound('User not found');
  await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } }, create: { blockerId: userId, blockedId: targetId }, update: {} });
  return { blocked: true };
}
export async function unblockUser(userId, targetId) {
  await prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  return { blocked: false };
}
export const blockedIds = async (userId) => (await prisma.userBlock.findMany({ where: { blockerId: userId }, select: { blockedId: true }, take: 500 })).map((b) => b.blockedId);
