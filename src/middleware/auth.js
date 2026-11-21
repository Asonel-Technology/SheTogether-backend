import { prisma } from '../config/db.js';
import { TtlCache } from '../utils/cache.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { verifyAccessToken } from '../core/tokens.js';

// Short-lived cache so authenticated requests do not hit the DB every time.
// Suspension/role changes call invalidateAuthUser(); other instances catch up within the TTL.
const cache = new TtlCache(15_000, 2000);
export const invalidateAuthUser = (id) => cache.delete(id);

const SELECT = {
  id: true,
  role: true,
  status: true,
  ageBand: true,
  preferredLanguage: true,
  username: true,
  tokenVersion: true,
  suspendedUntil: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
};

async function loadUser(id) {
  let u = cache.get(id);
  if (u === undefined) {
    u = await prisma.user.findUnique({ where: { id }, select: SELECT });
    if (u) cache.set(id, u);
  }
  return u;
}

async function resolve(req) {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('Malformed Authorization header');
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (e) {
    throw unauthorized(e.name === 'TokenExpiredError' ? 'Access token expired' : 'Invalid access token', e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
  }
  const u = await loadUser(payload.sub);
  if (!u || u.tokenVersion !== payload.tv) throw unauthorized('Session is no longer valid', 'INVALID_TOKEN');
  const suspended = u.status === 'SUSPENDED' && (!u.suspendedUntil || u.suspendedUntil > new Date());
  if (u.status === 'BANNED' || suspended) throw forbidden('Your account is not active', 'ACCOUNT_DISABLED');
  return { ...u, verified: Boolean(u.emailVerifiedAt || u.phoneVerifiedAt) };
}

export async function authenticate(req, _res, next) {
  const u = await resolve(req);
  if (!u) throw unauthorized();
  req.user = u;
  next();
}

export async function optionalAuth(req, _res, next) {
  req.user = await resolve(req);
  next();
}

export const authorize = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) return next(forbidden(`Requires one of the roles: ${roles.join(', ')}`));
  next();
};
