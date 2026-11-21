import { prisma } from '../config/db.js';
import { audit } from '../core/audit.js';
import { getSetting } from '../core/settings.js';
import { paginate, pageMeta } from '../core/schemas.js';
import { TtlCache } from '../utils/cache.js';
import { conflict, notFound } from '../utils/errors.js';
import { assertUsableMedia, mediaUrl } from './media.service.js';

/**
 * Ads are placement-based sponsored cards only. No targeting by user, age, health topic or chat content.
 * Eligible ads per slot are cached for everybody (one query per minute per slot).
 */
const cache = new TtlCache(60_000, 10);

async function eligible(slot) {
  let rows = cache.get(slot);
  if (!rows) {
    const now = new Date();
    rows = await prisma.adPlacement.findMany({
      where: { slot, active: true, approvalStatus: 'APPROVED', paymentStatus: { in: ['PAID', 'WAIVED'] }, startAt: { lte: now }, endAt: { gte: now }, advertiser: { active: true, verificationStatus: 'VERIFIED' } },
      select: { id: true, slot: true, title: true, text: true, targetUrl: true, creative: { select: { secureUrl: true, status: true } }, advertiser: { select: { businessName: true } } },
      take: 30,
    });
    cache.set(slot, rows);
  }
  return rows;
}

export async function listAds(slot, limit) {
  if (!(await getSetting('ads_enabled'))) return [];
  const rows = [...(await eligible(slot))].sort(() => Math.random() - 0.5).slice(0, limit);
  return rows.map((a) => ({ id: a.id, slot: a.slot, title: a.title, text: a.text, targetUrl: a.targetUrl, imageUrl: mediaUrl(a.creative), advertiser: a.advertiser.businessName, sponsored: true, label: 'Advertisement' }));
}

// Counters are buffered in memory and flushed in one transaction every few seconds (cheap under load).
const buffer = new Map();
export function countEvent(id, field) {
  const e = buffer.get(id) ?? { impressions: 0, clicks: 0 };
  e[field] += 1;
  buffer.set(id, e);
}
export async function flushCounters() {
  if (!buffer.size) return;
  const batch = [...buffer];
  buffer.clear();
  try {
    await prisma.$transaction(batch.map(([id, c]) => prisma.adPlacement.updateMany({ where: { id }, data: { impressions: { increment: c.impressions }, clicks: { increment: c.clicks } } })));
  } catch {
    for (const [id, c] of batch) { // put back so nothing is lost
      const e = buffer.get(id) ?? { impressions: 0, clicks: 0 };
      e.impressions += c.impressions; e.clicks += c.clicks; buffer.set(id, e);
    }
  }
}
export const startCounterFlush = () => setInterval(flushCounters, 10_000).unref();

// ── Admin ───────────────────────────────────────────────────────────────────
export const listAdvertisers = async (pq) => {
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([prisma.advertiser.findMany({ orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take }), prisma.advertiser.count()]);
  return { items, meta: pageMeta(total, pg) };
};
export async function createAdvertiser(actor, data) {
  const a = await prisma.advertiser.create({ data });
  await audit(actor, 'advertiser.created', 'advertiser', a.id);
  return a;
}
export async function updateAdvertiser(actor, id, data) {
  const a = await prisma.advertiser.update({ where: { id }, data });
  cache.clear();
  await audit(actor, 'advertiser.updated', 'advertiser', id, data);
  return a;
}
export async function listPlacements({ slot, approvalStatus, ...pq }) {
  const where = { ...(slot ? { slot } : {}), ...(approvalStatus ? { approvalStatus } : {}) };
  const pg = paginate(pq);
  const [items, total] = await prisma.$transaction([
    prisma.adPlacement.findMany({ where, orderBy: { id: 'desc' }, skip: pg.skip, take: pg.take, include: { advertiser: { select: { businessName: true } } } }),
    prisma.adPlacement.count({ where }),
  ]);
  return { items, meta: pageMeta(total, pg) };
}
export async function createPlacement(actor, data) {
  await assertUsableMedia([data.creativeMediaId], { purposes: ['ADVERTISEMENT'] });
  if (!(await prisma.advertiser.findUnique({ where: { id: data.advertiserId }, select: { id: true } }))) throw notFound('Advertiser not found');
  const p = await prisma.adPlacement.create({ data });
  await audit(actor, 'ad.created', 'ad', p.id);
  return p;
}
export async function updatePlacement(actor, id, data) {
  if (data.creativeMediaId) await assertUsableMedia([data.creativeMediaId], { purposes: ['ADVERTISEMENT'] });
  const p = await prisma.adPlacement.update({ where: { id }, data });
  cache.clear();
  await audit(actor, 'ad.updated', 'ad', id, data);
  return p;
}
export async function decide(actor, id, approvalStatus) {
  const adv = await prisma.adPlacement.findUnique({ where: { id }, select: { advertiser: { select: { verificationStatus: true } } } });
  if (!adv) throw notFound('Ad not found');
  if (approvalStatus === 'APPROVED' && adv.advertiser.verificationStatus !== 'VERIFIED') throw conflict('Verify the advertiser before approving ads', 'ADVERTISER_NOT_VERIFIED');
  const p = await prisma.adPlacement.update({ where: { id }, data: { approvalStatus } });
  cache.clear();
  await audit(actor, `ad.${approvalStatus.toLowerCase()}`, 'ad', id);
  return p;
}
export async function report() {
  const rows = await prisma.adPlacement.findMany({ select: { id: true, title: true, slot: true, impressions: true, clicks: true, paymentStatus: true, approvalStatus: true, monthlyFee: true, currency: true, startAt: true, endAt: true, advertiser: { select: { businessName: true } } }, orderBy: { impressions: 'desc' }, take: 200 });
  return rows.map((r) => ({ ...r, ctr: r.impressions ? Number((r.clicks / r.impressions).toFixed(4)) : 0 }));
}
