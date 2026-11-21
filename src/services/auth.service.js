import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AGE_BANDS, MAX_AGE, MIN_AGE, ageToBand, bandOrdinal, policy } from '../config/policy.js';
import { allSettings } from '../core/settings.js';
import { issueTokens, revokeAllSessions } from '../core/tokens.js';
import { invalidateAuthUser } from '../middleware/auth.js';
import { sendOtp } from './notifier.js';
import { addMinutes, hmac, normalizePhone, safeEqual } from '../utils/helpers.js';
import { badRequest, conflict, forbidden, tooMany, unauthorized, unprocessable } from '../utils/errors.js';
import { toUserDto } from './user.dto.js';

// Constant-time dummy hash so unknown identifiers cost the same as wrong passwords (no user enumeration).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const hashPassword = (pw) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);

/** Derive the age band from `age` or `dateOfBirth`. The exact DOB is never stored. */
export function bandFromInput({ age, dateOfBirth }) {
  let years = age;
  if (dateOfBirth) {
    const dob = new Date(`${dateOfBirth}T00:00:00Z`);
    const now = new Date();
    if (Number.isNaN(dob.getTime()) || dob > now) throw badRequest('Invalid date of birth');
    years = now.getUTCFullYear() - dob.getUTCFullYear();
    const hadBirthday = now.getUTCMonth() > dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
    if (!hadBirthday) years -= 1;
  }
  if (years < MIN_AGE || years > MAX_AGE) {
    throw unprocessable(`She Together is designed for people aged ${MIN_AGE}–${MAX_AGE}`, 'AGE_NOT_SUPPORTED');
  }
  return ageToBand(years);
}

/** identifier → Prisma `where`. Accepts email, phone (E.164 or Rwandan local) or username. */
export function identifierWhere(identifier) {
  const v = identifier.trim();
  if (v.includes('@')) return { email: v.toLowerCase() };
  const phone = /^[+\d][\d\s\-().]+$/.test(v) ? normalizePhone(v) : null;
  if (phone) return { phone };
  return { username: v.toLowerCase() };
}

// ── One-time codes ──────────────────────────────────────────────────────────
const otpHash = (userId, purpose, code) => hmac(env.OTP_SECRET, `${userId}:${purpose}:${code}`);

async function createOtp(user, purpose, channel, to) {
  const last = await prisma.otpCode.findFirst({ where: { userId: user.id, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (last && Date.now() - last.createdAt.getTime() < policy.otp.resendCooldownSeconds * 1000) {
    throw tooMany(`Please wait ${policy.otp.resendCooldownSeconds} seconds before requesting another code`, 'OTP_COOLDOWN');
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await prisma.$transaction([
    prisma.otpCode.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.otpCode.create({ data: { userId: user.id, purpose, codeHash: otpHash(user.id, purpose, code), expiresAt: addMinutes(new Date(), env.OTP_TTL_MINUTES) } }),
  ]);
  await sendOtp({ channel, to, code, purpose });
  return env.EXPOSE_DEV_OTP ? code : undefined;
}

/** Returns true when the code is valid (and consumes it). Wrong guesses are counted and the code burns after 5. */
async function consumeOtp(userId, purpose, code) {
  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!otp) return false;
  if (otp.attempts >= policy.otp.maxAttempts) return false;
  if (!safeEqual(otp.codeHash, otpHash(userId, purpose, code))) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  const claimed = await prisma.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  return claimed.count === 1;
}

// ── Public operations ───────────────────────────────────────────────────────
export async function register(input) {
  const settings = await allSettings();
  if (!settings.registration_enabled) throw forbidden('Registration is currently closed', 'REGISTRATION_CLOSED');

  const email = input.email?.toLowerCase() ?? null;
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw badRequest('Invalid phone number', [{ in: 'body', path: 'phone', message: 'Use international format, e.g. +250788123456' }], 'VALIDATION_ERROR');
  const ageBand = bandFromInput(input);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        phone,
        username: input.username,
        passwordHash: await hashPassword(input.password),
        ageBand,
        preferredLanguage: input.preferredLanguage,
        termsVersion: settings.terms_version,
        termsAcceptedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  } catch (e) {
    if (e.code === 'P2002') {
      const f = [].concat(e.meta?.target ?? []).join(',');
      throw conflict(f.includes('username') ? 'Username is already taken' : 'An account with these details already exists', 'ALREADY_REGISTERED');
    }
    throw e;
  }

  // Send verification codes best-effort; registration must not fail if delivery fails.
  let devCodes;
  try {
    const codes = {};
    if (email) codes.email = await createOtp(user, 'VERIFY_EMAIL', 'email', email);
    if (phone) codes.phone = await createOtp(user, 'VERIFY_PHONE', 'phone', phone);
    if (env.EXPOSE_DEV_OTP) devCodes = codes;
  } catch {
    /* ignore */
  }

  const { tokens } = await issueTokens(user);
  return { user: toUserDto(user), tokens, ...(devCodes ? { devVerificationCodes: devCodes } : {}) };
}

export async function login({ identifier, password }) {
  const user = await prisma.user.findUnique({ where: identifierWhere(identifier) });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user) throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw tooMany('Too many failed attempts. Try again later or reset your password.', 'ACCOUNT_LOCKED');
  }
  if (!ok) {
    const { failedLoginCount } = await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    if (failedLoginCount >= policy.login.maxFailures) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: addMinutes(new Date(), policy.login.lockMinutes) } });
    }
    throw unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  const suspended = user.status === 'SUSPENDED' && (!user.suspendedUntil || user.suspendedUntil > new Date());
  if (user.status === 'BANNED' || suspended) throw forbidden('Your account is not active', 'ACCOUNT_DISABLED');

  const data = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() };
  if (user.status === 'SUSPENDED') Object.assign(data, { status: 'ACTIVE', suspendedUntil: null }); // suspension expired
  const fresh = await prisma.user.update({ where: { id: user.id }, data });
  if (user.status === 'SUSPENDED') invalidateAuthUser(user.id);

  const { tokens } = await issueTokens(fresh);
  return { user: toUserDto(fresh), tokens };
}

export async function requestVerification(user, channel) {
  const u = await prisma.user.findUnique({ where: { id: user.id } });
  const to = channel === 'email' ? u.email : u.phone;
  if (!to) throw badRequest(`No ${channel} on this account`, undefined, 'NO_IDENTIFIER');
  if (channel === 'email' ? u.emailVerifiedAt : u.phoneVerifiedAt) throw conflict(`${channel} is already verified`, 'ALREADY_VERIFIED');
  const devCode = await createOtp(u, channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE', channel, to);
  return { sent: true, expiresInMinutes: env.OTP_TTL_MINUTES, ...(devCode ? { devCode } : {}) };
}

export async function confirmVerification(user, { channel, code }) {
  const purpose = channel === 'email' ? 'VERIFY_EMAIL' : 'VERIFY_PHONE';
  if (!(await consumeOtp(user.id, purpose, code))) throw badRequest('Invalid or expired code', undefined, 'INVALID_CODE');
  await prisma.user.update({ where: { id: user.id }, data: channel === 'email' ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() } });
  invalidateAuthUser(user.id);
  return { verified: true, channel };
}

export async function forgotPassword({ identifier }) {
  const where = identifierWhere(identifier);
  const generic = { message: 'If an account exists, a reset code has been sent.' };
  if (where.username) return generic; // codes are only sent to an email address or phone number
  const user = await prisma.user.findUnique({ where });
  if (!user || user.status === 'BANNED') return generic;
  try {
    const channel = where.email ? 'email' : 'phone';
    const devCode = await createOtp(user, 'RESET_PASSWORD', channel, where.email ?? where.phone);
    return devCode ? { ...generic, devCode } : generic;
  } catch (e) {
    if (e.status === 429) throw e;
    return generic;
  }
}

export async function resetPassword({ identifier, code, newPassword }) {
  const where = identifierWhere(identifier);
  const fail = () => badRequest('Invalid or expired code', undefined, 'INVALID_CODE');
  if (where.username) throw fail();
  const user = await prisma.user.findUnique({ where });
  if (!user || !(await consumeOtp(user.id, 'RESET_PASSWORD', code))) throw fail();

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null } });
  await revokeAllSessions(user.id); // password reset logs out every device
  return { reset: true };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  await revokeAllSessions(userId);
  const fresh = await prisma.user.findUnique({ where: { id: userId } });
  const { tokens } = await issueTokens(fresh);
  return { tokens };
}

export { AGE_BANDS, bandOrdinal };
