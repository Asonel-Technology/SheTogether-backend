import { env } from './env.js';

// Age bands, ordered youngest → oldest. Exact bands must be finalised with safeguarding/content experts.
export const AGE_BANDS = ['AGE_10_12', 'AGE_13_15', 'AGE_16_17', 'AGE_18_24', 'AGE_25_35'];
export const MIN_AGE = 10;
export const MAX_AGE = 35;
export const LANGUAGES = ['en', 'rw', 'sw', 'fr', 'ar'];
export const ROLES = ['USER', 'PROFESSIONAL', 'MODERATOR', 'CONTENT_REVIEWER', 'ADMIN'];
export const STAFF_ROLES = ['MODERATOR', 'CONTENT_REVIEWER', 'ADMIN'];
export const MINOR_BANDS = ['AGE_10_12', 'AGE_13_15', 'AGE_16_17'];

export const bandOrdinal = (band) => AGE_BANDS.indexOf(band);
export const isMinorBand = (band) => MINOR_BANDS.includes(band);

export function ageToBand(age) {
  if (age <= 12) return 'AGE_10_12';
  if (age <= 15) return 'AGE_13_15';
  if (age <= 17) return 'AGE_16_17';
  if (age <= 24) return 'AGE_18_24';
  return 'AGE_25_35';
}

/** Prisma `where` fragment: content whose [min,max] band range contains `band`. */
export function audienceWhere(band) {
  const o = bandOrdinal(band);
  return { minAgeBand: { in: AGE_BANDS.slice(0, o + 1) }, maxAgeBand: { in: AGE_BANDS.slice(o) } };
}
/** Anonymous visitors only get content suitable for every age band. */
export const ALL_AGES_WHERE = { minAgeBand: 'AGE_10_12', maxAgeBand: 'AGE_25_35' };
export const audienceFor = (user) => (user ? audienceWhere(user.ageBand) : ALL_AGES_WHERE);

export const policy = Object.freeze({
  community: {
    minBandToPost: env.COMMUNITY_MIN_BAND_TO_POST,
    segregateMinors: env.COMMUNITY_SEGREGATE_MINORS,
    autoHideThreshold: env.AUTO_HIDE_REPORT_THRESHOLD,
  },
  password: { min: 8, maxBytes: 72 }, // bcrypt only uses the first 72 bytes
  login: { maxFailures: 5, lockMinutes: 15 },
  otp: { maxAttempts: 5, resendCooldownSeconds: 60 },
});

export const DEFAULT_SETTINGS = {
  chat_enabled: true,
  community_enabled: true,
  ads_enabled: true,
  registration_enabled: true,
  terms_version: env.TERMS_VERSION,
  maintenance_message: null,
};

/** Last-resort emergency numbers (Rwanda) if the referral directory has none. Re-verify before launch. */
export const FALLBACK_EMERGENCY = [
  { name: 'Emergency (Police)', phone: '112' },
  { name: 'Ambulance (SAMU)', phone: '912' },
  { name: 'Gender-based violence (RIB)', phone: '3512' },
  { name: 'Child helpline', phone: '116' },
  { name: 'Isange One Stop Centre', phone: '3029' },
];
