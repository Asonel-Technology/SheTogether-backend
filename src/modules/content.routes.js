import { z } from 'zod';
import { defineModule, page } from '../core/route.js';
import { language, pageQuery, isoDate } from '../core/schemas.js';
import * as content from '../services/content.service.js';

const slugParams = z.object({ slug: z.string().min(1).max(120) });
const listQuery = pageQuery.extend({
  language: language.optional().describe('Defaults to the user\'s preferred language (or `en` when anonymous)'),
  category: z.string().max(80).optional().describe('Category slug'),
  q: z.string().trim().min(2).max(80).optional().describe('Search in title and summary'),
});

export default defineModule({
  tag: 'Content',
  description: '📚 **Learning Library** — Browse and search approved CSE/SRHR articles. Results are filtered server-side by the caller\'s age band and preferred language. Anonymous callers only receive all-ages content. Use `GET /content/home` for a personalised feed and `GET /content/offline` for PWA incremental sync.',
  base: '/content',
  routes: [
    { method: 'get', path: '/categories', summary: 'List content categories', auth: false, cache: 'public, max-age=300', handler: () => content.listCategories() },
    {
      method: 'get', path: '/home', summary: 'Personalised home: featured, latest and categories', auth: 'optional', cache: 'private, max-age=30',
      query: z.object({ language: language.optional() }),
      handler: ({ user, query }) => content.home(user, query),
    },
    {
      method: 'get', path: '/', summary: 'Browse / search articles', auth: 'optional', query: listQuery, cache: 'private, max-age=30',
      handler: async ({ user, query }) => {
        const { items, meta } = await content.listArticles(user, query);
        return page(items, meta);
      },
    },
    {
      method: 'get', path: '/offline', summary: 'Articles flagged for offline use (PWA sync)', auth: 'optional',
      description: 'Returns full bodies. Pass `updatedSince` (ISO date) from the previous response\'s `syncedAt`-style timestamp for incremental sync.',
      query: z.object({ language: language.optional(), updatedSince: isoDate.optional() }),
      handler: async ({ user, query }) => page(await content.offlineBundle(user, query), { syncedAt: new Date().toISOString() }),
    },
    { method: 'get', path: '/:slug', summary: 'Read one article', auth: 'optional', params: slugParams, cache: 'private, max-age=60', handler: ({ user, params }) => content.getArticle(user, params.slug) },
    { method: 'put', path: '/:slug/save', summary: 'Save article to my library', auth: true, params: slugParams, handler: ({ user, params }) => content.saveArticle(user, params.slug) },
    { method: 'delete', path: '/:slug/save', summary: 'Remove article from my library', auth: true, params: slugParams, handler: ({ user, params }) => content.unsaveArticle(user, params.slug) },
  ],
});
