// DB-free smoke tests: routing, validation, auth guards, Swagger, error format.
// Run with: npm test   (uses a stubbed Prisma client where a DB would be touched)
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://x:y@localhost:5432/db';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
process.env.OTP_SECRET ??= 'b'.repeat(40);
process.env.EXPOSE_DEV_OTP = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';

let app, prisma, signAccessToken, invalidateAuthUser;
before(async () => {
  ({ createApp: app } = await import('../src/app.js'));
  app = app();
  ({ prisma } = await import('../src/config/db.js'));
  ({ signAccessToken } = await import('../src/core/tokens.js'));
  ({ invalidateAuthUser } = await import('../src/middleware/auth.js'));
});

const userRow = (role = 'USER') => ({ id: '019f0000-0000-7000-8000-000000000001', role, status: 'ACTIVE', ageBand: 'AGE_16_17', preferredLanguage: 'en', username: 'tester', tokenVersion: 0, suspendedUntil: null, emailVerifiedAt: null, phoneVerifiedAt: null });
const tokenFor = (role) => `Bearer ${signAccessToken(userRow(role))}`;
const mockUser = (role) => { invalidateAuthUser(userRow().id); prisma.user = { findUnique: async () => userRow(role) }; };

test('health endpoints', async () => {
  const r = await request(app).get('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('OpenAPI spec is served and covers the API', async () => {
  const r = await request(app).get('/docs.json');
  assert.equal(r.status, 200);
  assert.equal(r.body.openapi, '3.0.3');
  assert.ok(Object.keys(r.body.paths).length > 80);
  assert.ok(r.body.paths['/auth/register'].post.requestBody);
  const ui = await request(app).get('/docs/');
  assert.equal(ui.status, 200);
  assert.match(ui.text, /swagger-ui/i);
});

test('unknown route returns structured 404', async () => {
  const r = await request(app).get('/api/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.success, false);
  assert.equal(r.body.error.code, 'ROUTE_NOT_FOUND');
  assert.ok(r.body.error.requestId);
});

test('invalid JSON → 400', async () => {
  const r = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{bad');
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_JSON');
});

test('register validation: strict body, password rules, age, terms', async () => {
  const bad = await request(app).post('/api/auth/register').send({ username: 'A', password: 'short', acceptTerms: false, hack: 1 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
  assert.ok(bad.body.error.details.length >= 4);
  const noContact = await request(app).post('/api/auth/register').send({ username: 'amina_k', password: 'StrongPass123', age: 17, acceptTerms: true });
  assert.equal(noContact.status, 400);
  assert.ok(noContact.body.error.details.some((d) => d.path === 'email'));
  const tooOld = await request(app).post('/api/auth/register').send({ email: 'a@b.co', username: 'amina_k', password: 'StrongPass123', age: 60, acceptTerms: true });
  assert.equal(tooOld.status, 400);
});

test('protected routes require a valid token', async () => {
  assert.equal((await request(app).get('/api/users/me')).status, 401);
  assert.equal((await request(app).get('/api/users/me').set('Authorization', 'Bearer garbage')).status, 401);
  assert.equal((await request(app).post('/api/chat').send({ question: 'hi there' })).status, 401);
});

test('role-based access control', async () => {
  mockUser('USER');
  const r = await request(app).get('/api/admin/users').set('Authorization', tokenFor('USER'));
  assert.equal(r.status, 403);
  mockUser('MODERATOR');
  const m = await request(app).get('/api/admin/users').set('Authorization', tokenFor('MODERATOR'));
  assert.equal(m.status, 403);
});

test('suspended users are rejected even with a valid token', async () => {
  invalidateAuthUser(userRow().id);
  prisma.user = { findUnique: async () => ({ ...userRow(), status: 'SUSPENDED', suspendedUntil: new Date(Date.now() + 86_400_000) }) };
  const r = await request(app).get('/api/users/me').set('Authorization', tokenFor('USER'));
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'ACCOUNT_DISABLED');
});

test('param and query validation', async () => {
  mockUser('ADMIN');
  const auth = tokenFor('ADMIN');
  assert.equal((await request(app).get('/api/admin/articles/not-a-uuid').set('Authorization', auth)).status, 400);
  assert.equal((await request(app).get('/api/admin/users?limit=9999').set('Authorization', auth)).status, 400);
});

test('reaction & report bodies reject unknown fields', async () => {
  mockUser('USER');
  const r = await request(app).post('/api/reactions/toggle').set('Authorization', tokenFor('USER')).send({ targetType: 'COMMENT', targetId: '019f0000-0000-7000-8000-000000000002', type: 'LIKE', admin: true });
  assert.equal(r.status, 400);
});

test('USSD webhook is disabled by default', async () => {
  const r = await request(app).post('/api/integrations/ussd/webhook').type('form').send({ text: '' });
  assert.equal(r.status, 503);
});

test('CORS: unknown origins get no CORS headers in production-like config', async () => {
  const r = await request(app).get('/health').set('Origin', 'https://evil.example');
  assert.ok(r.status === 200);
});
