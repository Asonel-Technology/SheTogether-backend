import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { ageBand, bandRange, idParams, language, pageQuery, text, uuid } from '../core/schemas.js';
import * as kb from '../services/knowledge.service.js';

const STAFF = ['ADMIN', 'CONTENT_REVIEWER'];
const status = z.enum(['DRAFT', 'IN_REVIEW', 'REJECTED', 'PUBLISHED', 'ARCHIVED']);
const fields = {
  title: text(3, 200),
  organization: text(2, 200).describe('Source organisation / author'),
  sourceUrl: z.url().max(500).optional(),
  body: z.string().trim().min(50).max(100_000),
  minAgeBand: ageBand,
  maxAgeBand: ageBand,
};
const patch = z.object({ ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])), changeNote: text(1, 300).optional() }).strict().refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export default defineModule({
  tag: 'Admin · Chatbot Knowledge',
  description: '🧠 **Admin — Chatbot Knowledge Base** — Manage the reviewed knowledge sources that power the AI chatbot. Only PUBLISHED versions are chunked, embedded via pgvector and searchable. Workflow: DRAFT → IN_REVIEW → PUBLISHED. Updating a source creates a new version; old chunks are disabled, never mixed. Use `POST /retrieval-test` to evaluate retrieval quality before publishing.',
  base: '/admin/knowledge',
  routes: [
    { method: 'get', path: '/sources', summary: 'List knowledge sources', auth: STAFF, query: pageQuery.extend({ status: status.optional(), language: language.optional() }), handler: async ({ query }) => { const { items, meta } = await kb.listSources(query); return page(items, meta); } },
    {
      method: 'post', path: '/sources', summary: 'Create a source (DRAFT v1 – invisible to users and the chatbot)', status: 201, auth: STAFF,
      body: bandRange(z.object({ language, ...fields }).strict()),
      handler: ({ user, body }) => kb.createSource(user, body),
    },
    { method: 'get', path: '/sources/:id', summary: 'Get a source with all versions', auth: STAFF, params: idParams, handler: ({ params }) => kb.getSource(params.id) },
    { method: 'post', path: '/sources/:id/versions', summary: 'Start a new draft version', status: 201, auth: STAFF, params: idParams, handler: ({ user, params }) => kb.knowledgeWorkflow.createDraft(params.id, user) },
    { method: 'post', path: '/sources/:id/unpublish', summary: 'Unpublish (disables its chunks)', auth: STAFF, params: idParams, handler: ({ user, params }) => kb.knowledgeWorkflow.unpublish(params.id, user) },
    { method: 'post', path: '/sources/:id/reindex', summary: 'Re-embed the published version', auth: ['ADMIN'], params: idParams, handler: ({ user, params }) => kb.reindex(user, params.id) },
    { method: 'patch', path: '/versions/:id', summary: 'Edit a DRAFT/REJECTED version', auth: STAFF, params: idParams, body: patch, handler: ({ user, params, body }) => kb.updateVersion(user, params.id, body) },
    { method: 'post', path: '/versions/:id/submit', summary: 'Submit for expert review', auth: STAFF, params: idParams, handler: ({ user, params }) => kb.knowledgeWorkflow.submit(params.id, user) },
    { method: 'post', path: '/versions/:id/approve', summary: 'Approve: publish, chunk and embed', auth: STAFF, params: idParams, body: z.object({ note: text(3, 500).optional() }).strict(), description: 'Chunking and embeddings are generated before publishing; if the AI provider fails nothing is published.', handler: ({ user, params, body }) => kb.knowledgeWorkflow.approve(params.id, user, body.note) },
    { method: 'post', path: '/versions/:id/reject', summary: 'Reject with review note', auth: STAFF, params: idParams, body: z.object({ note: text(3, 500) }).strict(), handler: ({ user, params, body }) => kb.knowledgeWorkflow.reject(params.id, user, body.note) },
    {
      method: 'post', path: '/retrieval-test', summary: 'Test which chunks are retrieved for a question', auth: STAFF,
      description: 'Use this to evaluate retrieval quality per language/age band before judging generated answers. No LLM call is made.',
      body: z.object({ question: text(2, 1000), language, ageBand, k: z.number().int().min(1).max(12).default(5) }).strict(),
      handler: ({ body }) => kb.retrievalTest(body),
    },
  ],
});
