import { z } from 'zod';
import { defineModule } from '../core/route.js';
import { ageInput, ageInputMessage, hasAgeInput, language } from '../core/schemas.js';
import { policy } from '../config/policy.js';
import * as auth from '../services/auth.service.js';
import { revokeAllSessions, revokeFamilyByToken, rotateRefreshToken } from '../core/tokens.js';
import { loginLimiter, otpLimiter, refreshLimiter, registerLimiter } from '../middleware/rateLimit.js';

export const passwordSchema = z
  .string()
  .min(policy.password.min)
  .max(128)
  .refine((v) => Buffer.byteLength(v) <= policy.password.maxBytes, { message: 'Password must be at most 72 bytes' })
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Password must contain at least one letter and one number' })
  .meta({ example: 'StrongPass123' });

export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,20}$/, 'Use 3–20 lowercase letters, numbers or underscores').meta({ example: 'amina_k' });

const registerBody = z
  .object({
    email: z.email().max(254).optional().meta({ example: 'amina@example.com' }),
    phone: z.string().trim().max(20).optional().meta({ example: '+250788123456' }),
    username: usernameSchema,
    password: passwordSchema,
    ...ageInput,
    preferredLanguage: language.default('en'),
    acceptTerms: z.literal(true).describe('Must be true: user accepted the terms and privacy notice'),
  })
  .strict()
  .refine((v) => v.email || v.phone, { message: 'Provide an email or a phone number', path: ['email'] })
  .refine(hasAgeInput, ageInputMessage);

const channel = z.enum(['email', 'phone']);

export default defineModule({
  tag: 'Auth',
  description: '🔐 **Authentication** — Register a new account, log in, rotate refresh tokens, verify your email/phone with a 6-digit OTP, and reset your password. Start here: `POST /auth/register` then `POST /auth/login` to get your `accessToken`.',
  base: '/auth',
  routes: [
    {
      method: 'post', path: '/register', summary: 'Create an account', status: 201, use: [registerLimiter], auth: false,
      description: 'Only the derived **age band** is stored, never the exact date of birth. Supported ages: 10–35. In development with `EXPOSE_DEV_OTP=true` the verification codes are returned in `devVerificationCodes`.',
      body: registerBody,
      example: { email: 'amina@example.com', username: 'amina_k', password: 'StrongPass123', age: 17, preferredLanguage: 'rw', acceptTerms: true },
      handler: ({ body }) => auth.register(body),
    },
    {
      method: 'post', path: '/login', summary: 'Log in with email, phone or username', use: [loginLimiter], auth: false,
      body: z.object({ email: z.string().trim().min(3).max(254).describe('Your email address, phone number (+250…) or username').meta({ example: 'amina@example.com' }), password: z.string().min(1).max(128) }).strict(),
      example: { email: 'amina@example.com', password: 'StrongPass123' },
      handler: ({ body }) => auth.login({ identifier: body.email, password: body.password }),
    },
    {
      method: 'post', path: '/refresh', summary: 'Rotate refresh token and get a new access token', use: [refreshLimiter], auth: false,
      description: 'Refresh tokens are single-use. Re-using an old one revokes the whole session family.',
      body: z.object({ refreshToken: z.string().min(20).max(200) }).strict(),
      handler: async ({ body }) => ({ tokens: await rotateRefreshToken(body.refreshToken) }),
    },
    {
      method: 'post', path: '/logout', summary: 'Log out this session', auth: false,
      body: z.object({ refreshToken: z.string().min(20).max(200) }).strict(),
      handler: async ({ body }) => (await revokeFamilyByToken(body.refreshToken), { loggedOut: true }),
    },
    {
      method: 'post', path: '/logout-all', summary: 'Log out of every device', auth: true,
      handler: async ({ user }) => (await revokeAllSessions(user.id), { loggedOut: true }),
    },
    {
      method: 'post', path: '/verify/request', summary: 'Send a verification code to your email or phone', auth: true, use: [otpLimiter],
      body: z.object({ channel }).strict(),
      handler: ({ user, body }) => auth.requestVerification(user, body.channel),
    },
    {
      method: 'post', path: '/verify/confirm', summary: 'Confirm email/phone with the 6-digit code', auth: true, use: [otpLimiter],
      body: z.object({ channel, code: z.string().regex(/^\d{6}$/) }).strict(),
      handler: ({ user, body }) => auth.confirmVerification(user, body),
    },
    {
      method: 'post', path: '/forgot-password', summary: 'Request a password reset code', use: [otpLimiter], status: 202, auth: false,
      description: 'Always responds with the same message to avoid revealing which accounts exist. Codes go to an email address or phone number.',
      body: z.object({ email: z.string().trim().min(5).max(254).describe('Your email address or phone number').meta({ example: 'amina@example.com' }) }).strict(),
      handler: ({ body }) => auth.forgotPassword({ identifier: body.email }),
    },
    {
      method: 'post', path: '/reset-password', summary: 'Set a new password using the reset code', use: [otpLimiter], auth: false,
      description: 'Revokes every active session of the account.',
      body: z.object({ email: z.string().trim().min(5).max(254).describe('The email address or phone number you used to request the reset'), code: z.string().regex(/^\d{6}$/), newPassword: passwordSchema }).strict(),
      handler: ({ body }) => auth.resetPassword({ identifier: body.email, code: body.code, newPassword: body.newPassword }),
    },
  ],
});
