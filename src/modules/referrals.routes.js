import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { boolQuery, idParams, language, pageQuery, text } from '../core/schemas.js';
import * as ref from '../services/referral.service.js';

const SERVICE_TYPES = ['HOSPITAL', 'HEALTH_CENTER', 'CLINIC', 'YOUTH_FRIENDLY', 'GBV_SUPPORT', 'HOTLINE', 'COUNSELING', 'LEGAL_AID', 'EMERGENCY', 'OTHER'];
const serviceBody = z.object({
  name: text(2, 200),
  serviceType: z.enum(SERVICE_TYPES),
  description: text(1, 600).optional(),
  province: text(2, 80).optional(),
  district: text(2, 80).optional(),
  sector: text(2, 80).optional(),
  address: text(2, 250).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.email().optional(),
  website: z.url().optional(),
  hours: text(1, 200).optional(),
  languages: z.array(language).max(5).default([]),
  isEmergency: z.boolean().default(false),
  youthFriendly: z.boolean().default(false),
}).strict();

export const referrals = defineModule({
  tag: 'Referrals',
  description: '🏥 **Support Services & Referrals** — Search verified health facilities, hotlines, GBV support centres and legal aid services. Only verified and active entries are shown. Use `GET /referrals/emergency` for always-available emergency contacts.',
  base: '/referrals',
  routes: [
    {
      method: 'get', path: '/', summary: 'Search verified services', auth: false, cache: 'public, max-age=120',
      query: pageQuery.extend({ type: z.enum(SERVICE_TYPES).optional(), district: z.string().max(80).optional(), province: z.string().max(80).optional(), language: language.optional(), youthFriendly: boolQuery.optional(), emergency: boolQuery.optional(), q: z.string().trim().min(2).max(80).optional() }),
      handler: async ({ query }) => { const { items, meta } = await ref.listReferrals(query); return page(items, meta); },
    },
    { method: 'get', path: '/emergency', summary: 'Emergency contacts (always available, cached)', auth: false, cache: 'public, max-age=300', handler: () => ref.emergencyContacts() },
    { method: 'get', path: '/:id', summary: 'Service details', auth: false, params: idParams, handler: ({ params }) => ref.getReferral(params.id) },
  ],
});

const STAFF = ['ADMIN', 'CONTENT_REVIEWER'];
export const adminReferrals = defineModule({
  tag: 'Admin · Referrals',
  description: '🏥 **Admin — Referrals** — Maintain the referral directory: create, update and verify support services. Any change to contact details removes the verification flag until an admin re-verifies. Required roles: ADMIN or CONTENT_REVIEWER.',
  base: '/admin/referrals',
  routes: [
    { method: 'get', path: '/', summary: 'List all services (incl. unverified/inactive)', auth: STAFF, query: pageQuery.extend({ active: boolQuery.optional(), verified: boolQuery.optional() }), handler: async ({ query }) => { const { items, meta } = await ref.listAllReferrals(query); return page(items, meta); } },
    { method: 'post', path: '/', summary: 'Create service (unverified)', status: 201, auth: STAFF, body: serviceBody, handler: ({ user, body }) => ref.createReferral(user, body) },
    { method: 'patch', path: '/:id', summary: 'Update service', auth: STAFF, params: idParams, body: serviceBody.partial().extend({ active: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }), handler: ({ user, params, body }) => ref.updateReferral(user, params.id, body) },
    { method: 'post', path: '/:id/verify', summary: 'Mark service as verified', auth: ['ADMIN'], params: idParams, handler: ({ user, params }) => ref.verifyReferral(user, params.id) },
    { method: 'delete', path: '/:id', summary: 'Deactivate service', auth: ['ADMIN'], params: idParams, handler: ({ user, params }) => ref.deactivateReferral(user, params.id) },
  ],
});
