import express from 'express';
import { validate } from '../middleware/validate.js';
import { authenticate, optionalAuth, authorize } from '../middleware/auth.js';
import { registerOperation, tagDescriptions } from './openapi.js';
import { z } from 'zod';

/** Paginated result marker: `return page(items, meta)` from a handler. */
export const page = (items, meta) => ({ __page: true, items, meta });

const pathParamNames = (path) => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);

/**
 * Declare an API module. Each route definition is used for BOTH the Express route and the Swagger docs,
 * so documentation can never drift from the real validation rules.
 *
 *   auth: false | 'optional' | true | ['ADMIN', ...roles]
 *   use:   middleware that runs before authentication (IP rate limiters)
 *   limit: per-user rate limiter, runs after authentication
 */
export function defineModule({ tag, description, base, routes }) {
  tagDescriptions.set(tag, description);
  const router = express.Router();
  for (const r of routes) {
    const names = pathParamNames(r.path);
    const params = r.params ?? (names.length ? z.object(Object.fromEntries(names.map((n) => [n, z.string().min(1).max(120)]))) : undefined);
    const roles = Array.isArray(r.auth) ? r.auth : null;
    const chain = [...(r.use ?? [])];
    if (r.auth === 'optional') chain.push(optionalAuth);
    else if (r.auth) chain.push(authenticate);
    if (roles) chain.push(authorize(...roles));
    if (r.limit) chain.push(r.limit); // per-user limiter: runs after authentication
    chain.push(validate({ body: r.body, query: r.query, params }));

    const status = r.status ?? 200;
    router[r.method](r.path, ...chain, async (req, res) => {
      const result = await r.handler({
        req,
        res,
        user: req.user ?? null,
        body: req.valid.body,
        query: req.valid.query,
        params: req.valid.params,
      });
      if (r.cache) res.set('Cache-Control', r.cache);
      if (res.headersSent) return;
      if (result === undefined) return res.status(204).end();
      if (result?.__page) return res.status(status).json({ success: true, data: result.items, meta: result.meta });
      return res.status(status).json({ success: true, data: result });
    });

    registerOperation({
      tag,
      method: r.method,
      fullPath: `${base}${r.path === '/' ? '' : r.path}`,
      pathParams: names,
      operationId: `${r.method}_${(base + r.path).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
      summary: r.summary,
      description: r.description,
      auth: r.auth ?? false,
      body: r.body,
      query: r.query,
      params: r.params,
      status,
      example: r.example,
      response: r.response,
      returns: r.returns,
      contentType: r.contentType,
    });
  }
  return { base, router };
}
