import { prisma } from '../config/db.js';
import { FALLBACK_EMERGENCY } from '../config/policy.js';
import { audit } from '../core/audit.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { TtlCache } from '../utils/cache.js';
import { notFound } from '../utils/errors.js';

const PUBLIC_SELECT = { id: true, name: true, serviceType: true, description: true, province: true, district: true, sector: true, address: true, latitude: true, longitude: true, phone: true, email: true, website: true, hours: true, languages: true, isEmergency: true, youthFriendly: true, verifiedAt: true };
const VISIBLE = { active: true, verifiedAt: { not: null } }; // only verified, active services are ever shown publicly

export async function listReferrals({ type, district, province, language, youthFriendly, emergency, q, ...pq }) {
  const where = {
    ...VISIBLE,
    ...(type ? { serviceType: type } : {}),
    ...(district ? { district: { equals: district, mode: 'insensitive' } } : {}),
    ...(province ? { province: { equals: province, mode: 'insensitive' } } : {}),
    ...(language ? { languages: { has: language } } : {}),
    ...(youthFriendly !== undefined ? { youthFriendly } : {}),
    ...(emergency !== undefined ? { isEmergency: emergency } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
  };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.referralService.findMany({ where, select: PUBLIC_SELECT, orderBy: [{ isEmergency: 'desc' }, { name: 'asc' }], skip: pg.skip, take: pg.take }),
    prisma.referralService.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}

const emergencyCache = new TtlCache(300_000, 1);
/** Verified emergency contacts, cached. Falls back to built-in national numbers if the directory is empty. */
export async function emergencyContacts() {
  let c = emergencyCache.get('e');
  if (!c) {
    const rows = await prisma.referralService.findMany({ where: { ...VISIBLE, isEmergency: true }, select: { id: true, name: true, phone: true, serviceType: true, hours: true }, orderBy: { name: 'asc' }, take: 10 });
    c = emergencyCache.set('e', rows.length ? rows : FALLBACK_EMERGENCY);
  }
  return c;
}

/** Referral suggestions for the chatbot: emergency lines always first, then verified youth-friendly services. */
export async function suggestReferrals(limit = 4) {
  const emergency = await emergencyContacts();
  const others = await prisma.referralService.findMany({
    where: { ...VISIBLE, isEmergency: false, OR: [{ youthFriendly: true }, { serviceType: { in: ['GBV_SUPPORT', 'HOTLINE', 'COUNSELING'] } }] },
    select: { id: true, name: true, phone: true, serviceType: true, district: true, hours: true },
    take: limit,
  });
  return [...emergency, ...others];
}

export async function getReferral(id) {
  const r = await prisma.referralService.findFirst({ where: { id, ...VISIBLE }, select: PUBLIC_SELECT });
  if (!r) throw notFound('Service not found');
  return r;
}

// ── Admin ───────────────────────────────────────────────────────────────────
export async function listAllReferrals({ active, verified, ...pq }) {
  const where = { ...(active !== undefined ? { active } : {}), ...(verified !== undefined ? { verifiedAt: verified ? { not: null } : null } : {}) };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.referralService.findMany({ where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }),
    prisma.referralService.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}
export async function createReferral(actor, data) {
  const r = await prisma.referralService.create({ data });
  emergencyCache.clear();
  await audit(actor, 'referral.created', 'referral', r.id);
  return r;
}
export async function updateReferral(actor, id, data) {
  // Changing contact details invalidates the previous verification.
  const touchesContact = ['phone', 'email', 'address', 'name', 'website'].some((k) => k in data);
  const r = await prisma.referralService.update({ where: { id }, data: { ...data, ...(touchesContact ? { verifiedAt: null, verifiedById: null } : {}) } });
  emergencyCache.clear();
  await audit(actor, 'referral.updated', 'referral', id, { fields: Object.keys(data) });
  return r;
}
export async function verifyReferral(actor, id) {
  const r = await prisma.referralService.update({ where: { id }, data: { verifiedAt: new Date(), verifiedById: actor.id } });
  emergencyCache.clear();
  await audit(actor, 'referral.verified', 'referral', id);
  return r;
}
export async function deactivateReferral(actor, id) {
  await prisma.referralService.update({ where: { id }, data: { active: false } });
  emergencyCache.clear();
  await audit(actor, 'referral.deactivated', 'referral', id);
  return { deactivated: true };
}
