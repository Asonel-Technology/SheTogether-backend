import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { ageBand, idParams, isoDate, pageQuery, uuid } from '../core/schemas.js';
import { ROLES } from '../config/policy.js';
import * as admin from '../services/admin.service.js';

const run = (fn) => async (ctx) => { const { items, meta } = await fn(ctx); return page(items, meta); };
const ADMIN = ['ADMIN'];

const SETTING_SCHEMAS = {
  chat_enabled: z.boolean(),
  community_enabled: z.boolean(),
  ads_enabled: z.boolean(),
  registration_enabled: z.boolean(),
  terms_version: z.string().min(1).max(40),
  maintenance_message: z.string().max(300).nullable(),
};

export const adminModule = defineModule({
  tag: 'Admin · Users & System',
  description: '⚙️ **Admin — Users & System** — Search and manage user accounts (roles, status, age band), browse the full audit log, and toggle feature switches (chat, community, ads, registration). Required role: ADMIN. Feature keys: `chat_enabled`, `community_enabled`, `ads_enabled`, `registration_enabled`, `terms_version`, `maintenance_message`.',
  base: '/admin',
  routes: [
    {
      method: 'get', path: '/users', summary: 'Search users', auth: ADMIN,
      query: pageQuery.extend({ role: z.enum(ROLES).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION']).optional(), ageBand: ageBand.optional(), q: z.string().trim().min(2).max(80).optional() }),
      handler: run(({ query }) => admin.listUsers(query)),
    },
    { method: 'get', path: '/users/:id', summary: 'User details', auth: ADMIN, params: idParams, handler: ({ params }) => admin.getUser(params.id) },
    { method: 'patch', path: '/users/:id/role', summary: 'Change role', auth: ADMIN, params: idParams, description: 'Revokes the user\'s sessions so the change takes effect immediately. The last administrator cannot be demoted.', body: z.object({ role: z.enum(ROLES) }).strict(), handler: ({ user, params, body }) => admin.setRole(user, params.id, body.role) },
    { method: 'patch', path: '/users/:id/status', summary: 'Set account status', auth: ADMIN, params: idParams, body: z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']), suspendDays: z.number().int().min(1).max(365).optional() }).strict(), handler: ({ user, params, body }) => admin.setStatus(user, params.id, body) },
    { method: 'patch', path: '/users/:id/age-band', summary: 'Override a user\'s age band (support case)', auth: ADMIN, params: idParams, body: z.object({ ageBand }).strict(), handler: ({ user, params, body }) => admin.setAgeBand(user, params.id, body.ageBand) },
    {
      method: 'get', path: '/audit-logs', summary: 'Audit log', auth: ADMIN,
      query: pageQuery.extend({ actorId: uuid.optional(), entityType: z.string().max(40).optional(), action: z.string().max(60).optional(), from: isoDate.optional(), to: isoDate.optional() }),
      handler: run(({ query }) => admin.listAudit(query)),
    },
    { method: 'get', path: '/settings', summary: 'Current system settings', auth: ADMIN, handler: () => admin.getSettings() },
    {
      method: 'put', path: '/settings', summary: 'Change a system setting / feature switch', auth: ADMIN,
      description: 'Keys: `chat_enabled`, `community_enabled`, `ads_enabled`, `registration_enabled`, `terms_version`, `maintenance_message`. Use these as kill switches.',
      body: z.object({ key: z.enum(Object.keys(SETTING_SCHEMAS)), value: z.any() }).strict().superRefine((v, ctx) => {
        const r = SETTING_SCHEMAS[v.key]?.safeParse(v.value);
        if (r && !r.success) ctx.addIssue({ code: 'custom', path: ['value'], message: r.error.issues[0].message });
      }),
      example: { key: 'chat_enabled', value: false },
      handler: ({ user, body }) => admin.putSetting(user, body.key, body.value),
    },
  ],
});
