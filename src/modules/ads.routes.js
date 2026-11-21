import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { idParams, isoDate, pageQuery, text, uuid } from '../core/schemas.js';
import * as ads from '../services/ads.service.js';
import { adEventLimiter } from '../middleware/rateLimit.js';

const SLOTS = ['HOME_BANNER', 'LIBRARY_INLINE', 'CHANNEL_LIST'];
const date = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

export const publicAds = defineModule({
  tag: 'Ads',
  description: '📢 **Sponsored Ads** — Fetch approved ad placements for a given slot (HOME_BANNER, LIBRARY_INLINE, CHANNEL_LIST) and record impressions/clicks. Ads are always labelled as advertisements and are never targeted using health topics, chat history or age.',
  base: '/ads',
  routes: [
    { method: 'get', path: '/', summary: 'Get approved ads for a placement', auth: false, query: z.object({ slot: z.enum(SLOTS), limit: z.coerce.number().int().min(1).max(5).default(2) }), cache: 'public, max-age=30', handler: ({ query }) => ads.listAds(query.slot, query.limit) },
    { method: 'post', path: '/:id/impression', summary: 'Count an impression', auth: false, use: [adEventLimiter], status: 202, params: idParams, handler: ({ params }) => (ads.countEvent(params.id, 'impressions'), { counted: true }) },
    { method: 'post', path: '/:id/click', summary: 'Count a click', auth: false, use: [adEventLimiter], status: 202, params: idParams, handler: ({ params }) => (ads.countEvent(params.id, 'clicks'), { counted: true }) },
  ],
});

const advertiserBody = z.object({ businessName: text(2, 150), contactName: text(2, 100).optional(), contactEmail: z.email().optional(), contactPhone: z.string().trim().max(30).optional() }).strict();
const placementBody = z.object({
  advertiserId: uuid, creativeMediaId: uuid.optional(), slot: z.enum(SLOTS), title: text(3, 120), text: text(1, 300).optional(),
  targetUrl: z.url({ protocol: /^https$/ }).max(500), startAt: date, endAt: date,
  monthlyFee: z.number().min(0).max(100_000_000).default(0), currency: z.string().length(3).default('RWF'), paymentStatus: z.enum(['UNPAID', 'PAID', 'WAIVED']).default('UNPAID'),
}).strict().refine((v) => v.endAt > v.startAt, { message: 'endAt must be after startAt', path: ['endAt'] });

export const adminAds = defineModule({
  tag: 'Admin · Ads',
  description: '📢 **Admin — Ads** — Manage advertisers (create, verify), create and approve ad placements, update payment status, and view impressions/clicks/CTR performance reports. Required role: ADMIN.',
  base: '/admin',
  routes: [
    { method: 'get', path: '/advertisers', summary: 'List advertisers', auth: ['ADMIN'], query: pageQuery, handler: async ({ query }) => { const { items, meta } = await ads.listAdvertisers(query); return page(items, meta); } },
    { method: 'post', path: '/advertisers', summary: 'Create advertiser', status: 201, auth: ['ADMIN'], body: advertiserBody, handler: ({ user, body }) => ads.createAdvertiser(user, body) },
    { method: 'patch', path: '/advertisers/:id', summary: 'Update / verify advertiser', auth: ['ADMIN'], params: idParams, body: advertiserBody.partial().extend({ verificationStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(), active: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }), handler: ({ user, params, body }) => ads.updateAdvertiser(user, params.id, body) },
    { method: 'get', path: '/ads', summary: 'List ad placements', auth: ['ADMIN'], query: pageQuery.extend({ slot: z.enum(SLOTS).optional(), approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), handler: async ({ query }) => { const { items, meta } = await ads.listPlacements(query); return page(items, meta); } },
    { method: 'post', path: '/ads', summary: 'Create ad placement (starts PENDING)', status: 201, auth: ['ADMIN'], body: placementBody, handler: ({ user, body }) => ads.createPlacement(user, body) },
    { method: 'patch', path: '/ads/:id', summary: 'Update placement (payment status, dates, active)', auth: ['ADMIN'], params: idParams, body: z.object({ title: text(3, 120).optional(), text: text(1, 300).optional(), targetUrl: z.url({ protocol: /^https$/ }).optional(), startAt: date.optional(), endAt: date.optional(), paymentStatus: z.enum(['UNPAID', 'PAID', 'WAIVED']).optional(), monthlyFee: z.number().min(0).optional(), active: z.boolean().optional(), creativeMediaId: uuid.optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }), handler: ({ user, params, body }) => ads.updatePlacement(user, params.id, body) },
    { method: 'post', path: '/ads/:id/decision', summary: 'Approve or reject an ad', auth: ['ADMIN'], params: idParams, body: z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }).strict(), handler: ({ user, params, body }) => ads.decide(user, params.id, body.decision) },
    { method: 'get', path: '/ads-report', summary: 'Impressions, clicks and CTR per placement', auth: ['ADMIN'], handler: () => ads.report() },
  ],
});
