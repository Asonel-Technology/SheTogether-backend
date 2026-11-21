// End-to-end auth flow against an in-memory fake of the Prisma calls used (no database needed).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://x:y@localhost:5432/db';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
process.env.OTP_SECRET ??= 'b'.repeat(40);
process.env.EXPOSE_DEV_OTP = 'true';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.BCRYPT_ROUNDS = '8';

let app;
const db = { users: [], tokens: [], otps: [] };
let n = 0;
const id = () => `019f0000-0000-7000-8000-${String(++n).padStart(12, '0')}`;

before(async () => {
  const { prisma } = await import('../src/config/db.js');
  Object.assign(prisma, {
    $transaction: async (a) => (typeof a === 'function' ? a(prisma) : Promise.all(a)),
    systemSetting: { findMany: async () => [] },
    user: {
      create: async ({ data }) => {
        if (db.users.some((u) => (data.email && u.email === data.email) || u.username === data.username)) throw Object.assign(new Error('dup'), { code: 'P2002', meta: { target: ['username'] } });
        const u = { id: id(), role: 'USER', status: 'ACTIVE', tokenVersion: 0, failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: null, phoneVerifiedAt: null, suspendedUntil: null, createdAt: new Date(), email: null, phone: null, ...data };
        db.users.push(u);
        return u;
      },
      findUnique: async ({ where }) => db.users.find((u) => (where.id && u.id === where.id) || (where.email && u.email === where.email) || (where.username && u.username === where.username) || (where.phone && u.phone === where.phone)) ?? null,
      update: async ({ where, data }) => {
        const u = db.users.find((x) => x.id === where.id);
        for (const [k, v] of Object.entries(data)) u[k] = v && typeof v === 'object' && 'increment' in v ? u[k] + v.increment : v;
        return u;
      },
    },
    otpCode: {
      findFirst: async ({ where }) => [...db.otps].reverse().find((o) => o.userId === where.userId && o.purpose === where.purpose && (where.consumedAt === undefined || !o.consumedAt) && (!where.expiresAt || o.expiresAt > new Date())) ?? null,
      updateMany: async ({ where, data }) => { let c = 0; db.otps.forEach((o) => { if (o.id === where.id || (o.userId === where.userId && o.purpose === where.purpose && !o.consumedAt)) { if (where.consumedAt === null && o.consumedAt) return; Object.assign(o, data); c++; } }); return { count: c }; },
      create: async ({ data }) => { const o = { id: id(), createdAt: new Date(), attempts: 0, consumedAt: null, ...data }; db.otps.push(o); return o; },
      update: async ({ where, data }) => { const o = db.otps.find((x) => x.id === where.id); o.attempts += data.attempts.increment; return o; },
    },
    refreshToken: {
      create: async ({ data }) => { const t = { id: id(), revokedAt: null, ...data }; db.tokens.push(t); return { id: t.id }; },
      findUnique: async ({ where }) => { const t = db.tokens.find((x) => x.tokenHash === where.tokenHash); return t ? { ...t, user: db.users.find((u) => u.id === t.userId) } : null; },
      updateMany: async ({ where, data }) => { let c = 0; db.tokens.forEach((t) => { if ((where.id ? t.id === where.id : true) && (where.family ? t.family === where.family : true) && (where.userId ? t.userId === where.userId : true) && (where.revokedAt === null ? !t.revokedAt : true)) { Object.assign(t, data); c++; } }); return { count: c }; },
      update: async ({ where, data }) => Object.assign(db.tokens.find((t) => t.id === where.id), data),
    },
  });
  app = (await import('../src/app.js')).createApp();
});

const body = { email: 'amina@example.com', username: 'amina_k', password: 'StrongPass123', dateOfBirth: '2009-01-01', preferredLanguage: 'rw', acceptTerms: true };
let tokens;

test('register derives age band, hides secrets, returns tokens + dev OTP', async () => {
  const r = await request(app).post('/api/auth/register').send(body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.user.ageBand, 'AGE_16_17');
  assert.equal(r.body.data.user.passwordHash, undefined);
  assert.match(r.body.data.devVerificationCodes.email, /^\d{6}$/);
  assert.ok(r.body.data.tokens.accessToken && r.body.data.tokens.refreshToken);
  assert.equal(db.users[0].dateOfBirth, undefined); // exact DOB never stored
  assert.notEqual(db.users[0].passwordHash, body.password);
});

test('duplicate username/email → 409', async () => {
  const r = await request(app).post('/api/auth/register').send(body);
  assert.equal(r.status, 409);
});

test('login: wrong password and unknown user look identical; success works', async () => {
  const wrong = await request(app).post('/api/auth/login').send({ identifier: 'amina@example.com', password: 'Nope12345' });
  const unknown = await request(app).post('/api/auth/login').send({ identifier: 'ghost@example.com', password: 'Nope12345' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error.code, unknown.body.error.code);
  const ok = await request(app).post('/api/auth/login').send({ identifier: 'AMINA_K', password: 'StrongPass123' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  tokens = ok.body.data.tokens;
});

test('refresh rotates; re-using the old token revokes the family', async () => {
  const a = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: tokens.refreshToken });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.error.code, 'REFRESH_TOKEN_REUSED');
  const newer = await request(app).post('/api/auth/refresh').send({ refreshToken: a.body.data.tokens.refreshToken });
  assert.equal(newer.status, 401); // whole family revoked
});

test('account locks after repeated failures', async () => {
  for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ identifier: 'amina@example.com', password: 'Wrong12345' });
  const r = await request(app).post('/api/auth/login').send({ identifier: 'amina@example.com', password: 'StrongPass123' });
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'ACCOUNT_LOCKED');
});

test('forgot-password never reveals whether the account exists', async () => {
  const known = await request(app).post('/api/auth/forgot-password').send({ identifier: 'amina@example.com' });
  const unknown = await request(app).post('/api/auth/forgot-password').send({ identifier: 'ghost@example.com' });
  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.equal(known.body.data.message, unknown.body.data.message);
});
