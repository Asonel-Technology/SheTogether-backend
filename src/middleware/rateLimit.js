import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const make = ({ windowMs, limit, byUser = false, skipSuccessfulRequests = false, message }) =>
  env.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs,
        limit,
        skipSuccessfulRequests,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: (req) => (byUser && req.user ? `u:${req.user.id}` : ipKeyGenerator(req.ip)),
        handler: (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED', message ?? 'Too many requests, please slow down')),
      })
    : (_req, _res, next) => next();

const MIN = 60_000;
export const globalLimiter = make({ windowMs: MIN, limit: 300 });
export const loginLimiter = make({ windowMs: 15 * MIN, limit: 10, skipSuccessfulRequests: true, message: 'Too many login attempts. Try again later.' });
export const registerLimiter = make({ windowMs: 60 * MIN, limit: 10 });
export const otpLimiter = make({ windowMs: 15 * MIN, limit: 6, message: 'Too many code requests. Try again later.' });
export const refreshLimiter = make({ windowMs: MIN, limit: 30 });
// Per-user limiters: these must be placed AFTER `authenticate` in the chain – see route `use` ordering below.
export const chatLimiter = make({ windowMs: MIN, limit: 10, byUser: true, message: 'You are sending messages too quickly.' });
export const writeLimiter = make({ windowMs: MIN, limit: 30, byUser: true });
export const mediaLimiter = make({ windowMs: MIN, limit: 20, byUser: true });
export const analyticsLimiter = make({ windowMs: MIN, limit: 60 });
export const adEventLimiter = make({ windowMs: MIN, limit: 120 });
