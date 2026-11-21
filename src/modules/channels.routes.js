import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { ageBand, bandRange, cursorQuery, idParams, pageQuery, slugSchema, text, uuid } from '../core/schemas.js';
import * as ch from '../services/channel.service.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const run = (fn) => async (ctx) => { const { items, meta } = await fn(ctx); return page(items, meta); };
const types = z.enum(['OFFICIAL', 'PROFESSIONAL', 'ORGANIZATION']);
const postStatus = z.enum(['PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'REMOVED']);

export const channelsModule = defineModule({
  tag: 'Channels',
  description: '📡 **Channels** — Verified professional and organisation channels with reviewed posts. Only channels verified and suitable for the caller\'s age band are listed. Users can follow channels and professionals can publish posts (subject to review).',
  base: '/channels',
  routes: [
    { method: 'get', path: '/', summary: 'List verified channels', auth: true, query: pageQuery.extend({ type: types.optional() }), handler: run(({ user, query }) => ch.listChannels(user, query)) },
    { method: 'get', path: '/:id', summary: 'Channel details', auth: true, params: idParams, handler: ({ user, params }) => ch.getChannel(user, params.id) },
    { method: 'put', path: '/:id/follow', summary: 'Follow a channel', auth: true, params: idParams, handler: ({ user, params }) => ch.follow(user, params.id) },
    { method: 'delete', path: '/:id/follow', summary: 'Unfollow a channel', auth: true, params: idParams, handler: ({ user, params }) => ch.unfollow(user, params.id) },
    {
      method: 'get', path: '/:id/posts', summary: 'Channel posts (cursor pagination)', auth: true, params: idParams,
      query: cursorQuery.extend({ status: postStatus.optional().describe('Only honoured for the channel owner / admin') }),
      handler: run(({ user, params, query }) => ch.listPosts(user, params.id, query)),
    },
    {
      method: 'post', path: '/:id/posts', summary: 'Publish a post (channel owner only)', status: 201, auth: ['PROFESSIONAL', 'ADMIN'], limit: writeLimiter, params: idParams,
      description: 'Posts enter `PENDING_REVIEW` when the channel requires review (default); admins publish directly.',
      body: z.object({ text: text(2, 3000), mediaId: uuid.optional() }).strict(),
      handler: ({ user, params, body }) => ch.createPost(user, params.id, body),
    },
    {
      method: 'patch', path: '/posts/:id', summary: 'Edit my channel post', auth: ['PROFESSIONAL', 'ADMIN'], params: idParams,
      body: z.object({ text: text(2, 3000).optional(), mediaId: uuid.nullable().optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
      handler: ({ user, params, body }) => ch.updatePost(user, params.id, body),
    },
    { method: 'delete', path: '/posts/:id', summary: 'Delete my channel post', auth: ['PROFESSIONAL', 'ADMIN'], params: idParams, handler: ({ user, params }) => ch.deletePost(user, params.id) },
  ],
});

const REVIEW = ['ADMIN', 'CONTENT_REVIEWER'];
export const adminChannelsModule = defineModule({
  tag: 'Admin · Channels',
  description: '📡 **Admin — Channels** — Create and verify channels, assign owners, review professional posts (PENDING_REVIEW queue), and decide professional verification applications. Required roles: ADMIN or CONTENT_REVIEWER.',
  base: '/admin',
  routes: [
    { method: 'get', path: '/channels', summary: 'List all channels', auth: ['ADMIN'], query: pageQuery, handler: run(({ query }) => ch.listAdminChannels(query)) },
    {
      method: 'post', path: '/channels', summary: 'Create a channel', status: 201, auth: ['ADMIN'],
      body: bandRange(z.object({
        name: text(3, 120), slug: slugSchema.optional(), description: text(5, 600), channelType: types, ownerId: uuid.optional(),
        verificationStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).default('UNVERIFIED'),
        minAgeBand: ageBand.default('AGE_10_12'), maxAgeBand: ageBand.default('AGE_25_35'), requiresReview: z.boolean().default(true),
      }).strict()),
      handler: ({ user, body }) => ch.createChannel(user, body),
    },
    {
      method: 'patch', path: '/channels/:id', summary: 'Update / verify / assign owner', auth: ['ADMIN'], params: idParams,
      body: z.object({ name: text(3, 120).optional(), description: text(5, 600).optional(), ownerId: uuid.nullable().optional(), verificationStatus: z.enum(['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(), minAgeBand: ageBand.optional(), maxAgeBand: ageBand.optional(), requiresReview: z.boolean().optional(), isActive: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
      handler: ({ user, params, body }) => ch.updateChannel(user, params.id, body),
    },
    { method: 'get', path: '/channel-posts', summary: 'Posts awaiting review (default)', auth: REVIEW, query: pageQuery.extend({ status: postStatus.optional() }), handler: run(({ query }) => ch.listPendingPosts(query)) },
    {
      method: 'post', path: '/channel-posts/:id/review', summary: 'Approve or reject a channel post', auth: REVIEW, params: idParams,
      body: z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: text(3, 500).optional() }).strict().refine((v) => v.decision === 'APPROVED' || v.note, { message: 'A note is required when rejecting', path: ['note'] }),
      handler: ({ user, params, body }) => ch.reviewPost(user, params.id, body),
    },
    { method: 'get', path: '/professional-applications', summary: 'Professional applications (pending by default)', auth: ['ADMIN'], query: pageQuery.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }), handler: run(({ query }) => ch.listApplications(query)) },
    {
      method: 'post', path: '/professional-applications/:id/decision', summary: 'Approve / reject a professional application', auth: ['ADMIN'], params: idParams,
      description: 'Approval grants the PROFESSIONAL role (verified badge) and optionally assigns a channel. Badges are never self-assigned.',
      body: z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: text(3, 500).optional(), channelId: uuid.optional() }).strict(),
      handler: ({ user, params, body }) => ch.decideApplication(user, params.id, body),
    },
  ],
});

export const professionalModule = defineModule({
  tag: 'Professional Verification',
  description: '🏥 **Professional Verification** — Apply to be recognised as a verified healthcare professional or organisation. Once approved by an admin you receive the PROFESSIONAL role and a verified badge. Use `GET /professional-applications/mine` to track your application status.',
  base: '/professional-applications',
  routes: [
    {
      method: 'post', path: '/', summary: 'Apply for professional verification', status: 201, auth: true,
      body: z.object({ organizationName: text(2, 150), professionalTitle: text(2, 120), licenseNumber: text(2, 60).optional(), details: text(10, 1000), contactEmail: z.email().optional(), contactPhone: z.string().trim().max(30).optional() }).strict(),
      handler: ({ user, body }) => ch.applyAsProfessional(user, body),
    },
    { method: 'get', path: '/mine', summary: 'My applications', auth: true, handler: ({ user }) => ch.myApplications(user.id) },
  ],
});
