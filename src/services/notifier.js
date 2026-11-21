import { env, isProd } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Delivery of one-time codes. No provider is wired in yet:
 *  - development: the code is logged to the server console (never in production)
 *  - production: plug an email provider (SMTP/Resend/SendGrid) and an SMS provider
 *    (e.g. Africa's Talking) into `sendEmail` / `sendSms` below.
 */
async function sendEmail(to, subject, body) {
  if (!isProd) logger.info({ to, subject, body }, '[dev notifier] email');
  else logger.warn('No email provider configured: OTP email was not delivered');
}
async function sendSms(to, body) {
  if (!isProd) logger.info({ to, body }, '[dev notifier] sms');
  else logger.warn('No SMS provider configured: OTP SMS was not delivered');
}

const SUBJECT = { VERIFY: 'Your She Together verification code', RESET: 'Your She Together password reset code' };

export async function sendOtp({ channel, to, code, purpose }) {
  const reset = purpose === 'RESET_PASSWORD';
  const text = `${reset ? 'Password reset' : 'Verification'} code: ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Never share this code.`;
  if (channel === 'email') return sendEmail(to, reset ? SUBJECT.RESET : SUBJECT.VERIFY, text);
  return sendSms(to, `She Together: ${text}`);
}
