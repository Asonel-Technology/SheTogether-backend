import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { ageBand, bandRange, idParams, language, pageQuery, slugSchema, text, uuid } from '../core/schemas.js';
import * as content from '../services/content.service.js';

const STAFF = ['ADMIN', 'CONTENT_REVIEWER'];
const versionStatus = z.enum(['DRAFT', 'IN_REVIEW', 'REJECTED', 'PUBLISHED', 'ARCHIVED']);

const versionFields = {
  title: text(3, 200),
  summary: text(10, 400),
  body: z.string().trim().min(20).max(60_000).describe('Markdown'),
  ussdSummary: text(5, 150).nullable().optional().describe('Short plain-text version for USSD (≤150 chars)'),
  minAgeBand: ageBand,
  maxAgeBand: ageBand,
  coverMediaId: uuid.nullable().optional(),
  audioMediaId: uuid.nullable().optional(),
};
const createArticleBody = bandRange(
  z.object({
    slug: slugSchema.optional(),
    language,
    categoryId: uuid,
    translationKey: z.string().max(80).optional().describe('Share one key between translations of the same article'),
    isFeatured: z.boolean().default(false),
    offlineEligible: z.boolean().default(false),
    ...versionFields,
  }).strict(),
);
const versionPatch = z.object({ ...Object.fromEntries(Object.entries(versionFields).map(([k, v]) => [k, v.optional()])), changeNote: text(1, 300).optional() }).strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
const note = z.object({ note: text(3, 500).optional() }).strict();
const versionParams = z.object({ id: uuid });

export const categories = defineModule({
  tag: 'Admin · Categories',
  description: '🗂️ **Admin — Categories** — Create, update and delete the content categories used to organise learning articles. Required roles: ADMIN or CONTENT_REVIEWER.',
  base: '/admin/categories',
  routes: [
    { method: 'post', path: '/', summary: 'Create category', status: 201, auth: STAFF, body: z.object({ slug: slugSchema, name: text(2, 80), description: text(1, 300).optional(), sortOrder: z.number().int().min(0).max(1000).default(0) }).strict(), handler: ({ user, body }) => content.createCategory(user, body) },
    { method: 'patch', path: '/:id', summary: 'Update category', auth: STAFF, params: idParams, body: z.object({ slug: slugSchema.optional(), name: text(2, 80).optional(), description: text(1, 300).nullable().optional(), sortOrder: z.number().int().min(0).max(1000).optional() }).strict(), handler: ({ user, params, body }) => content.updateCategory(user, params.id, body) },
    { method: 'delete', path: '/:id', summary: 'Delete an unused category', auth: ['ADMIN'], params: idParams, handler: ({ user, params }) => content.deleteCategory(user, params.id) },
  ],
});

export const articles = defineModule({
  tag: 'Admin · Articles',
  description: '✍️ **Admin — Articles** — Author and publish CSE/SRHR articles through the review workflow: **DRAFT → IN_REVIEW → PUBLISHED**. Published versions are immutable; edits create a new version that must be reviewed again while the live version keeps serving. Required roles: ADMIN or CONTENT_REVIEWER.',
  base: '/admin',
  routes: [
    {
      method: 'get', path: '/articles', summary: 'List articles (all statuses)', auth: STAFF,
      query: pageQuery.extend({ status: versionStatus.optional().describe('Articles having a version in this status (e.g. IN_REVIEW = review queue)'), language: language.optional(), categoryId: uuid.optional(), q: z.string().trim().min(2).max(80).optional() }),
      handler: async ({ query }) => { const { items, meta } = await content.listAdminArticles(query); return page(items, meta); },
    },
    {
      method: 'post', path: '/articles', summary: 'Create an article with its first draft version', status: 201, auth: STAFF, body: createArticleBody,
      example: { language: 'en', categoryId: '<category id>', title: 'Understanding your menstrual cycle', summary: 'A simple guide to what happens during a monthly cycle.', body: '## Your cycle\nA typical cycle lasts 21–35 days...', minAgeBand: 'AGE_10_12', maxAgeBand: 'AGE_25_35', ussdSummary: 'A cycle is usually 21-35 days. Bleeding lasts 3-7 days.', offlineEligible: true },
      handler: ({ user, body }) => content.createArticle(user, body),
    },
    { method: 'get', path: '/articles/:id', summary: 'Get an article with all versions', auth: STAFF, params: idParams, handler: ({ params }) => content.getAdminArticle(params.id) },
    {
      method: 'patch', path: '/articles/:id', summary: 'Update article metadata (category, flags, slug)', auth: STAFF, params: idParams,
      body: z.object({ slug: slugSchema.optional(), categoryId: uuid.optional(), translationKey: z.string().max(80).nullable().optional(), isFeatured: z.boolean().optional(), offlineEligible: z.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }),
      handler: ({ user, params, body }) => content.updateArticleMeta(user, params.id, body),
    },
    { method: 'post', path: '/articles/:id/versions', summary: 'Start a new draft version from the latest one', status: 201, auth: STAFF, params: idParams, handler: ({ user, params }) => content.articleWorkflow.createDraft(params.id, user) },
    { method: 'post', path: '/articles/:id/unpublish', summary: 'Take the published version offline', auth: STAFF, params: idParams, handler: ({ user, params }) => content.articleWorkflow.unpublish(params.id, user) },
    { method: 'delete', path: '/articles/:id', summary: 'Delete an unpublished article', auth: ['ADMIN'], params: idParams, handler: ({ user, params }) => content.deleteArticle(user, params.id) },
    { method: 'patch', path: '/article-versions/:id', summary: 'Edit a DRAFT/REJECTED version', auth: STAFF, params: versionParams, body: versionPatch, handler: ({ user, params, body }) => content.updateArticleVersion(user, params.id, body) },
    { method: 'post', path: '/article-versions/:id/submit', summary: 'Submit a draft for review', auth: STAFF, params: versionParams, handler: ({ user, params }) => content.articleWorkflow.submit(params.id, user) },
    { method: 'post', path: '/article-versions/:id/approve', summary: 'Approve & publish a version', auth: STAFF, params: versionParams, body: note, description: 'The creator cannot approve their own version unless `ALLOW_SELF_APPROVAL=true`.', handler: ({ user, params, body }) => content.articleWorkflow.approve(params.id, user, body.note) },
    { method: 'post', path: '/article-versions/:id/reject', summary: 'Reject a version (back to the author)', auth: STAFF, params: versionParams, body: z.object({ note: text(3, 500) }).strict(), handler: ({ user, params, body }) => content.articleWorkflow.reject(params.id, user, body.note) },
  ],
});
