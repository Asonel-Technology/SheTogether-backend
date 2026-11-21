import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import crypto from 'node:crypto';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, isProd } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './config/db.js';
import { apiRouter } from './modules/index.js';
import { buildSpec } from './core/openapi.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // Request id first so every log line and error response can be correlated.
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: { ignore: (req) => req.url.startsWith('/health') }, serializers: { req: (r) => ({ id: r.id, method: r.method, url: r.url?.split('?')[0] }) } }));
  // `upgrade-insecure-requests` is only sent in production so Swagger UI works over plain http in development.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': isProd ? [] : null } } }));

  const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || origins.includes(origin) || (!isProd && origins.length === 0)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
    maxAge: 600,
  }));
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: '100kb', strict: true }));

  // Liveness (no DB) and readiness (DB) for load balancers / Azure / Render health checks.
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));
  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'database_unavailable' });
    }
  });

  app.use(globalLimiter);
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }); // routes opt in to caching explicitly
  app.use(env.API_PREFIX, apiRouter());

  if (env.SWAGGER_ENABLED) {
    const spec = buildSpec();
    app.get('/docs.json', (_req, res) => res.json(spec));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
      customSiteTitle: 'She Together API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, docExpansion: 'none', filter: true, tryItOutEnabled: true },
    }));
    app.get('/', (_req, res) => res.redirect('/docs'));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
