import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { addDays, randomToken, sha256 } from '../utils/helpers.js';
import { unauthorized } from '../utils/errors.js';
import { invalidateAuthUser } from '../middleware/auth.js';

const ISSUER = 'she-together-api';
const AUDIENCE = 'she-together-app';

export const signAccessToken = (user) =>
  jwt.sign({ role: user.role, tv: user.tokenVersion }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    algorithm: 'HS256',
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });

/** Create an access token + a new opaque refresh token (only its SHA-256 hash is stored). */
export async function issueTokens(user, family = crypto.randomUUID(), client = prisma) {
  const refreshToken = randomToken();
  const row = await client.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: sha256(refreshToken),
      family,
      expiresAt: addDays(new Date(), env.REFRESH_TOKEN_TTL_DAYS),
    },
    select: { id: true },
  });
  return {
    tokens: { accessToken: signAccessToken(user), refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL_SECONDS },
    refreshTokenId: row.id,
  };
}

/** Rotate a refresh token. A re-used (already rotated) token revokes the whole family (theft detection). */
export async function rotateRefreshToken(presented) {
  const hash = sha256(presented);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: {
      user: { select: { id: true, role: true, status: true, tokenVersion: true, suspendedUntil: true } },
    },
  });
  if (!row) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');

  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { family: row.family, revokedAt: null }, data: { revokedAt: new Date() } });
    throw unauthorized('Refresh token was already used. Please log in again.', 'REFRESH_TOKEN_REUSED');
  }
  if (row.expiresAt < new Date()) throw unauthorized('Refresh token expired', 'INVALID_REFRESH_TOKEN');

  const { user } = row;
  const suspended = user.status === 'SUSPENDED' && (!user.suspendedUntil || user.suspendedUntil > new Date());
  if (suspended || user.status === 'BANNED') throw unauthorized('Account is not active', 'ACCOUNT_DISABLED');

  // Atomically claim the token: if two requests race, only one wins.
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw unauthorized('Refresh token was already used', 'REFRESH_TOKEN_REUSED');
    const { tokens, refreshTokenId } = await issueTokens(user, row.family, tx);
    await tx.refreshToken.update({ where: { id: row.id }, data: { replacedById: refreshTokenId } });
    return tokens;
  });
}

export async function revokeFamilyByToken(presented) {
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) }, select: { family: true } });
  if (row) await prisma.refreshToken.updateMany({ where: { family: row.family, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Revoke every session of a user (password reset/change, suspension, ban) and kill live access tokens. */
export async function revokeAllSessions(userId, client = prisma) {
  await client.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await client.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  invalidateAuthUser(userId);
}
