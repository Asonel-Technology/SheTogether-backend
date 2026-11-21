import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/db.js';
import { flushCounters, startCounterFlush } from './services/ads.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`She Together API listening on :${env.PORT}  (docs: /docs, health: /health)`);
});
// Keep-alive longer than typical load balancer idle timeouts to avoid sporadic 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
startCounterFlush();

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await flushCounters().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    clearTimeout(force);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
