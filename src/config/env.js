import { z } from 'zod';

const bool = (def) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true'), z.boolean());
const int = (def, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : Number(v)), z.number().int().min(min).max(max));
const num = (def, min = 0, max = 1) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : Number(v)), z.number().min(min).max(max));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1, 65535),
  API_PREFIX: z.string().default('/api'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: int(1, 0, 10),
  CORS_ORIGINS: z.string().default(''),
  SWAGGER_ENABLED: bool(true),
  RATE_LIMIT_ENABLED: bool(true),

  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: int(900, 60, 86400),
  REFRESH_TOKEN_TTL_DAYS: int(30, 1, 365),
  BCRYPT_ROUNDS: int(12, 8, 15),
  OTP_TTL_MINUTES: int(10, 1, 60),
  EXPOSE_DEV_OTP: bool(false),

  TERMS_VERSION: z.string().default('2026-01'),
  REQUIRE_VERIFIED_FOR_POSTING: bool(false),
  ALLOW_SELF_APPROVAL: bool(false),
  COMMUNITY_SEGREGATE_MINORS: bool(true),
  COMMUNITY_MIN_BAND_TO_POST: z.enum(['AGE_10_12', 'AGE_13_15', 'AGE_16_17', 'AGE_18_24', 'AGE_25_35']).default('AGE_13_15'),
  AUTO_HIDE_REPORT_THRESHOLD: int(3, 1, 50),
  ACCOUNT_DELETION_GRACE_DAYS: int(30, 0, 365),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  RAG_TOP_K: int(5, 1, 12),
  RAG_MIN_SIMILARITY: num(0.3, 0, 1),
  RAG_FALLBACK_LANGUAGE: z.enum(['en', 'rw', 'sw', 'fr', 'ar', 'none']).default('en'),
  CHAT_RETAIN_MESSAGES: bool(false),
  CHAT_RETENTION_DAYS: int(30, 1, 365),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_ROOT_FOLDER: z.string().default('she-together'),
  MEDIA_VERIFY_UPLOADS: bool(true),

  USSD_ENABLED: bool(false),
  USSD_WEBHOOK_SECRET: z.string().optional(),

  ANALYTICS_RETENTION_DAYS: int(365, 30, 3650),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${lines.join('\n')}`);
  process.exit(1);
}

export const env = Object.freeze(parsed.data);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProd && env.EXPOSE_DEV_OTP) {
  console.error('EXPOSE_DEV_OTP must be false in production');
  process.exit(1);
}
if (env.USSD_ENABLED && !env.USSD_WEBHOOK_SECRET) {
  console.error('USSD_WEBHOOK_SECRET is required when USSD_ENABLED=true');
  process.exit(1);
}
