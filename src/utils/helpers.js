import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex');
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
export const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
export const addMinutes = (d, m) => new Date(d.getTime() + m * 60_000);
export const addDays = (d, n) => new Date(d.getTime() + n * 86_400_000);

/** Strip control characters / zero-width tricks and normalise whitespace in user text. */
export const cleanText = (s) =>
  String(s)
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

export const slugify = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';

export const uniqueSlug = (base) => `${slugify(base)}-${crypto.randomBytes(3).toString('hex')}`;

/** Normalise a phone number to E.164. Rwanda (+250) is assumed for local numbers starting with 0. */
export function normalizePhone(input) {
  let p = String(input).replace(/[\s\-().]/g, '');
  if (/^00/.test(p)) p = `+${p.slice(2)}`;
  if (/^0\d{9}$/.test(p)) p = `+250${p.slice(1)}`;
  if (/^250\d{9}$/.test(p)) p = `+${p}`;
  return /^\+[1-9]\d{7,14}$/.test(p) ? p : null;
}
