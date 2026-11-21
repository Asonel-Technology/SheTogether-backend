# She Together — Backend API

Node.js (Express 5) + Prisma + Neon PostgreSQL (pgvector) REST API for the She Together SRHR/CSE platform.
Frontend is a separate project. **All endpoints are documented and testable in Swagger UI at `/docs`.**

## Quick start

```bash
npm install                      # also runs `prisma generate`
cp .env.example .env             # fill DATABASE_URL, DIRECT_URL, secrets (see below)
npx prisma migrate dev --name init   # creates tables (+ vector / pg_trgm extensions)
npm run db:extras                # HNSW vector index + trigram search indexes (run once)
npm run db:seed                  # first admin, categories, national emergency contacts
npm run dev                      # http://localhost:4000/docs
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (use one each for `JWT_ACCESS_SECRET` and `OTP_SECRET`).

**Neon:** use the *pooled* connection string for `DATABASE_URL` and the *direct* one for `DIRECT_URL` (migrations).
pgvector is available on Neon; the migration enables it (`CREATE EXTENSION vector`).

## Testing in Swagger UI (`/docs`)

1. `POST /auth/login` with the seeded admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) → copy `data.tokens.accessToken`.
2. Click **Authorize** (top right) → paste the token (no `Bearer ` prefix). It is remembered across page reloads.
3. Suggested walkthrough:
   - **Content:** `POST /admin/categories` (or use seeded ones) → `POST /admin/articles` → `POST /admin/article-versions/{id}/submit` → `/approve` → `GET /content` as a normal user.
   - **Chatbot:** needs `OPENAI_API_KEY`. `POST /admin/knowledge/sources` → submit → approve (chunks + embeddings are created) → `POST /admin/knowledge/retrieval-test` → `POST /chat`.
   - **Users:** register a normal account (`POST /auth/register`; with `EXPOSE_DEV_OTP=true` the verification code is returned in the response) and test community, channels, reports and moderation with different roles. Change roles via `PATCH /admin/users/{id}/role`.
   - **Media:** needs Cloudinary credentials: `POST /media/signature` → upload from the browser → `POST /media`.
4. Responses always use `{ success, data, meta? }` or `{ success:false, error:{ code, message, details?, requestId } }`.

> Swagger "Try it out" for the USSD webhook sends form data; enable it with `USSD_ENABLED=true` and a `USSD_WEBHOOK_SECRET`.

## Structure

```
src/
  config/        env (validated with zod, fails fast), db, logger, policy (age bands, safeguarding defaults)
  core/          route DSL + OpenAPI generator, tokens (JWT/refresh), settings, audit, shared zod schemas
  middleware/    auth/RBAC, validation, rate limiting, error handler
  modules/       *.routes.js — route + validation + docs + thin controller (one source of truth for Swagger)
  services/      business logic (auth, content, knowledge/RAG, chat, community, moderation, channels, ads, media…)
  locales/       chatbot safety / fallback strings (en, rw, sw, fr, ar)
prisma/          schema.prisma, seed.js, sql/extras.sql
scripts/         maintenance.js (retention & cleanup job)
tests/           node:test + supertest (no database needed)
```

Swagger is generated **from the same Zod schemas that validate requests**, so docs cannot drift from behaviour.

## Roles

`USER`, `PROFESSIONAL`, `MODERATOR`, `CONTENT_REVIEWER`, `ADMIN`. Roles are enforced server-side on every route and are
shown in each endpoint's Swagger description. Professional/verified badges are only granted by an admin
(`POST /admin/professional-applications/{id}/decision`), never by signup.

## Security & privacy measures

- bcrypt (cost 12), password policy, login lockout, constant-time failure path (no user enumeration), generic forgot-password response.
- Short-lived access JWT (15 min) + **rotating single-use refresh tokens** stored only as SHA-256 hashes, with re-use detection (revokes the whole session family). Password reset/change, role change, suspension and ban revoke all sessions immediately.
- Strict Zod validation on every input (unknown fields rejected), parameterised queries only, 100 kB body limit, text sanitising.
- Helmet, CORS allow-list, tiered rate limits (login/OTP/refresh/chat/write/analytics/ads), request ids, pino logs with redaction.
  **Chat questions are never logged**, and are stored only if `CHAT_RETAIN_MESSAGES=true` (auto-expiring). OpenAI is called with `store:false`.
- Only the derived **age band** is stored (never date of birth). Age/language/audience filtering is done in the database query, not in the client.
- Chatbot: rule-based urgent-safety screen runs **before** any AI call (self-harm, abuse, medical emergency → escalation text + verified emergency contacts, no AI); retrieval only over **PUBLISHED** knowledge; strict JSON-schema output; prompt-injection hardening; confidence threshold; professional-referral flags.
- Published content is immutable; edits create new versions that need review; old vectors are disabled, never mixed.
- Community: minors/adults separated (configurable), report → auto-hide threshold, moderator queue, every action logged with reason, block lists, abuse rate limits.
- Media: signed direct uploads, role + type + size policy per purpose, server verification via Cloudinary Admin API, unguessable ids, disabled when content is removed.
- Audit log for admin/reviewer actions; kill switches (`chat_enabled`, `community_enabled`, `ads_enabled`, `registration_enabled`) via `PUT /admin/settings`.

## Performance

Prisma `select` only what is returned; list endpoints never return article bodies; time-ordered UUIDv7 keys with cursor pagination
for feeds/comments; composite & trigram indexes; HNSW vector index; denormalised counters; `$transaction` batches (single round-trip list+count);
in-process TTL caches (auth lookup, categories, settings, ad candidates, emergency contacts); batched ad counters flushed every 10 s;
gzip, ETags and explicit `Cache-Control`; embeddings computed *before* DB transactions so no connection is held during network calls.

## Deployment notes

- `npm run db:deploy` on release, `npm start` to run. `Dockerfile` included. Health: `/health` (liveness), `/health/ready` (DB).
- Set `NODE_ENV=production`, `EXPOSE_DEV_OTP=false`, `ALLOW_SELF_APPROVAL=false`, `CORS_ORIGINS=<your frontend origins>`, `TRUST_PROXY` for your host. Consider `SWAGGER_ENABLED=false` for the public production instance.
- Schedule `npm run maintenance` daily (expired tokens/OTPs, chat & analytics retention, account-deletion purge, stale vectors/media).
- Rate-limit counters are per-process; for several instances add a shared store (e.g. Redis) to `express-rate-limit`.

## Decisions you still need to make / provide

- **OTP delivery**: no email/SMS provider is wired in (`src/services/notifier.js` logs in dev only). Plug in your providers.
- **Safeguarding policy** (under-13 consent, who may post/comment, minors/adult separation, content age bands) — defaults are in `src/config/policy.js` and `.env`; confirm with your experts.
- **Safety keyword lists and the urgent-message translations** (rw/sw/fr/ar) are a starting point and must be reviewed by clinicians, safeguarding experts and native speakers.
- **Emergency numbers** seeded from public Rwandan sources — re-verify before launch.
- Chatbot thresholds (`RAG_MIN_SIMILARITY`, top-k) should be tuned with real reviewed content using `POST /admin/knowledge/retrieval-test`.
- Not included (by design for MVP): chat streaming, payments for ads, distance-sorted referral search, comments on channel posts.
