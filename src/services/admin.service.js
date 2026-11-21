import { prisma } from '../config/db.js';
import { audit } from '../core/audit.js';
import { clearSettingsCache, allSettings } from '../core/settings.js';
import { revokeAllSessions } from '../core/tokens.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { invalidateAuthUser } from '../middleware/auth.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';

const USER_LIST = { id: true, username: true, email: true, phone: true, role: true, status: true, ageBand: true, preferredLanguage: true, emailVerifiedAt: true, phoneVerifiedAt: true, suspendedUntil: true, lastLoginAt: true, createdAt: true };

export async function listUsers({ role, status, ageBand, q, ...pq }) {
  const where = {
    ...(role ? { role } : {}), ...(status ? { status } : {}), ...(ageBand ? { ageBand } : {}),
    ...(q ? { OR: [{ username: { contains: q.toLowerCase() } }, { email: { contains: q.toLowerCase() } }, { phone: { contains: q } }] } : {}),
  };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([prisma.user.findMany({ where, select: USER_LIST, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }), prisma.user.count({ where })]);
  return { items, meta: pageMeta(total, pg) };
}

export async function getUser(id) {
  const u = await prisma.user.findUnique({ where: { id }, select: { ...USER_LIST, termsVersion: true, termsAcceptedAt: true, deletionRequestedAt: true, _count: { select: { posts: true, comments: true } } } });
  if (!u) throw notFound('User not found');
  return u;
}

async function adminCount() {
  return prisma.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
}

export async function setRole(actor, id, role) {
  if (id === actor.id) throw forbidden('You cannot change your own role');
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw notFound('User not found');
  if (target.role === 'ADMIN' && role !== 'ADMIN' && (await adminCount()) <= 1) throw conflict('Cannot remove the last administrator', 'LAST_ADMIN');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { role } });
    await revokeAllSessions(id, tx); // role change takes effect immediately
    await audit(actor, 'user.role_changed', 'user', id, { from: target.role, to: role }, tx);
  });
  return { id, role };
}

export async function setStatus(actor, id, { status, suspendDays }) {
  if (id === actor.id) throw forbidden('You cannot change your own status');
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw notFound('User not found');
  if (target.role === 'ADMIN' && status !== 'ACTIVE' && (await adminCount()) <= 1) throw conflict('Cannot disable the last administrator', 'LAST_ADMIN');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { status, suspendedUntil: status === 'SUSPENDED' && suspendDays ? new Date(Date.now() + suspendDays * 86_400_000) : null } });
    if (status !== 'ACTIVE') await revokeAllSessions(id, tx);
    await audit(actor, 'user.status_changed', 'user', id, { status, suspendDays }, tx);
  });
  invalidateAuthUser(id);
  return { id, status };
}

export async function setAgeBand(actor, id, ageBand) {
  await prisma.user.update({ where: { id }, data: { ageBand } });
  invalidateAuthUser(id);
  await audit(actor, 'user.age_band_overridden', 'user', id, { ageBand });
  return { id, ageBand };
}

export async function listAudit({ actorId, entityType, action, from, to, ...pq }) {
  const where = { ...(actorId ? { actorId } : {}), ...(entityType ? { entityType } : {}), ...(action ? { action: { contains: action } } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }), prisma.auditLog.count({ where })]);
  return { items, meta: pageMeta(total, pg) };
}

export const getSettings = () => allSettings();
export async function putSetting(actor, key, value) {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value, updatedBy: actor.id }, update: { value, updatedBy: actor.id } });
  clearSettingsCache();
  await audit(actor, 'setting.changed', 'setting', key, { value });
  return allSettings();
}
