import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { boolQuery, cursorQuery, idParams, text, uuid } from '../core/schemas.js';
import * as community from '../services/community.service.js';
import * as moderation from '../services/moderation.service.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const targetTypes = ['COMMUNITY_POST', 'COMMENT', 'CHANNEL_POST', 'USER'];
const run = (fn) => async (ctx) => {
  const { items, meta } = await fn(ctx);
  return page(items, meta);
};

export const communityModule = defineModule({
  tag: 'Community',
  description: '💬 **Peer Community** — Moderated space for users to post questions and support each other. Minors and adults are separated by default (`COMMUNITY_SEGREGATE_MINORS=true`). Posts by blocked users are hidden from the blocker. New posts may require approval depending on the user\'s age band.',
  base: '/community',
  routes: [
    {
      method: 'get', path: '/posts', summary: 'Community feed (cursor pagination)', auth: true,
      query: cursorQuery.extend({ categoryId: uuid.optional(), mine: boolQuery.optional().describe('Only my own posts (any status except removed)') }),
      handler: run(({ user, query }) => community.listPosts(user, query)),
    },
    {
      method: 'post', path: '/posts', summary: 'Create a post', status: 201, auth: true, limit: writeLimiter,
      body: z.object({ text: text(2, 2000), categoryId: uuid.optional(), mediaId: uuid.optional().describe('Registered COMMUNITY media you own') }).strict(),
      example: { text: 'How do you talk to your mum about periods?' },
      handler: ({ user, body }) => community.createPost(user, body),
    },
    { method: 'get', path: '/posts/:id', summary: 'Get a post', auth: true, params: idParams, handler: ({ user, params }) => community.getPost(user, params.id) },
    { method: 'delete', path: '/posts/:id', summary: 'Delete my post', auth: true, params: idParams, handler: ({ user, params }) => community.deletePost(user, params.id) },
    {
      method: 'get', path: '/posts/:id/comments', summary: 'List comments (or replies with parentId)', auth: true, params: idParams,
      query: cursorQuery.extend({ parentId: uuid.optional().describe('Return replies to this top-level comment') }),
      handler: run(({ user, params, query }) => community.listComments(user, params.id, query)),
    },
    {
      method: 'post', path: '/posts/:id/comments', summary: 'Comment or reply (one level deep)', status: 201, auth: true, limit: writeLimiter, params: idParams,
      body: z.object({ text: text(1, 1000), parentId: uuid.optional() }).strict(),
      handler: ({ user, params, body }) => community.createComment(user, params.id, body),
    },
    { method: 'delete', path: '/comments/:id', summary: 'Delete my comment', auth: true, params: idParams, handler: ({ user, params }) => community.deleteComment(user, params.id) },
  ],
});

export const reactionsModule = defineModule({
  tag: 'Reactions & Reports',
  description: '👍 **Reactions & Reports** — Toggle emoji reactions (LIKE, SUPPORT, HELPFUL) on posts, comments and channel posts. Report harmful content or users for moderator review. Multiple distinct reports on the same item automatically hide it pending review.',
  base: '',
  routes: [
    {
      method: 'post', path: '/reactions/toggle', summary: 'Toggle a reaction', auth: true, limit: writeLimiter,
      description: 'Same reaction again removes it; a different reaction replaces it.',
      body: z.object({ targetType: z.enum(['COMMUNITY_POST', 'COMMENT', 'CHANNEL_POST']), targetId: uuid, type: z.enum(['LIKE', 'SUPPORT', 'HELPFUL']) }).strict(),
      handler: ({ user, body }) => community.toggleReaction(user, body),
    },
    {
      method: 'post', path: '/reports', summary: 'Report content or a user', status: 201, auth: true, limit: writeLimiter,
      description: 'Several distinct reports on the same post/comment automatically hide it pending moderator review.',
      body: z.object({ targetType: z.enum(targetTypes), targetId: uuid, reason: z.enum(['MISINFORMATION', 'HARASSMENT', 'UNSAFE_ADVICE', 'INAPPROPRIATE', 'SPAM', 'OTHER']), details: text(1, 500).optional() }).strict(),
      handler: ({ user, body }) => moderation.createReport(user, body),
    },
  ],
});

const MOD = ['MODERATOR', 'ADMIN'];
const pageQ = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export const moderationModule = defineModule({
  tag: 'Moderation',
  description: '🛡️ **Moderation** — Tools for MODERATOR and ADMIN roles. Work through the report queue, hide/remove/restore content, warn or suspend users. Every action is recorded in the audit log with a mandatory reason. Moderators cannot edit approved health content.',
  base: '/moderation',
  routes: [
    {
      method: 'get', path: '/reports', summary: 'Report queue (open + escalated by default)', auth: MOD,
      query: pageQ.extend({ status: z.enum(['OPEN', 'ESCALATED', 'RESOLVED', 'DISMISSED']).optional(), targetType: z.enum(targetTypes).optional() }),
      handler: run(({ query }) => moderation.listReports(query)),
    },
    { method: 'get', path: '/reports/:id', summary: 'Report detail with target snapshot and history', auth: MOD, params: idParams, handler: ({ params }) => moderation.getReport(params.id) },
    {
      method: 'post', path: '/reports/:id/resolve', summary: 'Resolve a report', auth: MOD, params: idParams,
      description: '`*_AUTHOR` actions apply to the owner of the reported content. `ESCALATE` keeps the report open for an administrator.',
      body: z.object({ action: z.enum(['DISMISS', 'HIDE', 'REMOVE', 'WARN_AUTHOR', 'SUSPEND_AUTHOR', 'BAN_AUTHOR', 'ESCALATE']), reason: text(3, 500), suspendDays: z.number().int().min(1).max(90).optional() }).strict(),
      handler: ({ user, params, body }) => moderation.resolveReport(user, params.id, body),
    },
    {
      method: 'post', path: '/actions', summary: 'Take a direct moderation action', status: 201, auth: MOD,
      description: 'HIDE/REMOVE/RESTORE target content. WARN/SUSPEND/UNSUSPEND/BAN target a USER (BAN is admin-only).',
      body: z.object({ targetType: z.enum(targetTypes), targetId: uuid, action: z.enum(['HIDE', 'REMOVE', 'RESTORE', 'WARN', 'SUSPEND', 'UNSUSPEND', 'BAN', 'ESCALATE']), reason: text(3, 500), suspendDays: z.number().int().min(1).max(90).optional() }).strict(),
      handler: ({ user, body }) => moderation.applyAction({ actor: user, ...body }),
    },
    {
      method: 'get', path: '/actions', summary: 'Moderation log', auth: MOD,
      query: pageQ.extend({ targetType: z.enum(targetTypes).optional(), targetId: uuid.optional() }),
      handler: run(({ query }) => moderation.listActions(query)),
    },
  ],
});
