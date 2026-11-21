import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Single shared client. Use the Neon *pooled* URL in DATABASE_URL.
// In NODE_ENV=test a plain object is used so the unit tests can inject fakes without a database.
export const prisma =
  env.NODE_ENV === 'test'
    ? {}
    : new PrismaClient({ log: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'] });
