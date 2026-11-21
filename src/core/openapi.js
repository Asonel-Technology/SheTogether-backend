import { z } from 'zod';
import { env } from '../config/env.js';

export const operations = [];
export const tagDescriptions = new Map();

const BIG = 9007199254740991;
function clean(node) {
  if (Array.isArray(node)) return node.map(clean);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'minimum' && v === -BIG) || (k === 'maximum' && v === BIG)) continue;
      if (k === 'pattern' && node.format === 'email') continue;
      if (k === '$schema') continue;
      out[k] = clean(v);
    }
    return out;
  }
  return node;
}
export const toSchema = (zodSchema) =>
  clean(z.toJSONSchema(zodSchema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' }));

export function registerOperation(op) {
  operations.push(op);
}

const errorRef = { $ref: '#/components/responses/Error' };

export function buildSpec() {
  const paths = {};
  for (const op of operations) {
    const parameters = [];
    for (const name of op.pathParams) {
      const s = op.params ? toSchema(op.params).properties?.[name] : null;
      parameters.push({ name, in: 'path', required: true, schema: s ?? { type: 'string' } });
    }
    if (op.query) {
      const js = toSchema(op.query);
      for (const [name, schema] of Object.entries(js.properties ?? {})) {
        const { description, ...rest } = schema;
        parameters.push({ name, in: 'query', required: (js.required ?? []).includes(name), description, schema: rest });
      }
    }
    const roles = Array.isArray(op.auth) ? op.auth : null;
    const description = [op.description, roles ? `**Required role:** ${roles.join(', ')}` : null, op.auth === 'optional' ? 'Authentication optional: anonymous callers only receive all-ages content.' : null]
      .filter(Boolean)
      .join('\n\n');
    const responses = {
      [op.status]: {
        description: op.returns ?? 'Success',
        content: {
          'application/json': {
            schema: op.response
              ? { type: 'object', properties: { success: { type: 'boolean', example: true }, data: toSchema(op.response) } }
              : { $ref: '#/components/schemas/Success' },
          },
        },
      },
    };
    if (op.body || op.query || op.pathParams.length) responses[400] = errorRef;
    if (op.auth) responses[401] = errorRef;
    if (roles) responses[403] = errorRef;
    if (op.pathParams.length) responses[404] = errorRef;
    responses[429] = errorRef;

    const operation = {
      tags: [op.tag],
      summary: op.summary,
      description,
      operationId: op.operationId,
      parameters,
      responses,
    };
    if (op.auth === true || roles) operation.security = [{ bearerAuth: [] }];
    else if (op.auth === 'optional') operation.security = [{}, { bearerAuth: [] }];
    else operation.security = [];
    if (op.body) {
      operation.requestBody = {
        required: true,
        content: { [op.contentType ?? 'application/json']: { schema: toSchema(op.body), ...(op.example ? { example: op.example } : {}) } },
      };
    }
    const p = op.fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    (paths[p] ??= {})[op.method] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'She Together API',
      version: '1.0.0',
      description:
        'Backend API for **She Together** — safe, private CSE/SRHR information for adolescents and young women (Rwanda-first).\n\n' +
        '**Testing in Swagger UI:** `POST /auth/login` → copy `data.tokens.accessToken` → click **Authorize** → paste the token (no "Bearer " prefix).\n\n' +
        'All responses use an envelope: `{ success, data, meta? }` or `{ success:false, error:{ code, message, details?, requestId } }`.',
    },
    servers: [{ url: env.API_PREFIX, description: 'Current server' }],
    tags: [
      // ── User-facing ──────────────────────────────────────────────────────────
      { name: 'Auth',                        description: tagDescriptions.get('Auth') },
      { name: 'Users',                       description: tagDescriptions.get('Users') },
      { name: 'Content',                     description: tagDescriptions.get('Content') },
      { name: 'Chatbot',                     description: tagDescriptions.get('Chatbot') },
      { name: 'Community',                   description: tagDescriptions.get('Community') },
      { name: 'Reactions & Reports',         description: tagDescriptions.get('Reactions & Reports') },
      { name: 'Channels',                    description: tagDescriptions.get('Channels') },
      { name: 'Professional Verification',   description: tagDescriptions.get('Professional Verification') },
      { name: 'Referrals',                   description: tagDescriptions.get('Referrals') },
      { name: 'Media',                       description: tagDescriptions.get('Media') },
      { name: 'Ads',                         description: tagDescriptions.get('Ads') },
      { name: 'Analytics',                   description: tagDescriptions.get('Analytics') },
      { name: 'USSD Integration',            description: tagDescriptions.get('USSD Integration') },
      // ── Staff / moderation ───────────────────────────────────────────────────
      { name: 'Moderation',                  description: tagDescriptions.get('Moderation') },
      // ── Admin ────────────────────────────────────────────────────────────────
      { name: 'Admin · Users & System',      description: tagDescriptions.get('Admin · Users & System') },
      { name: 'Admin · Categories',          description: tagDescriptions.get('Admin · Categories') },
      { name: 'Admin · Articles',            description: tagDescriptions.get('Admin · Articles') },
      { name: 'Admin · Chatbot Knowledge',   description: tagDescriptions.get('Admin · Chatbot Knowledge') },
      { name: 'Admin · Channels',            description: tagDescriptions.get('Admin · Channels') },
      { name: 'Admin · Referrals',           description: tagDescriptions.get('Admin · Referrals') },
      { name: 'Admin · Ads',                 description: tagDescriptions.get('Admin · Ads') },
      { name: 'Admin · Analytics',           description: tagDescriptions.get('Admin · Analytics') },
    ].filter((t) => t.description !== undefined),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Success: {
          type: 'object',
          properties: { success: { type: 'boolean', example: true }, data: {}, meta: { type: 'object' } },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object' } },
                requestId: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        Error: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  };
}
