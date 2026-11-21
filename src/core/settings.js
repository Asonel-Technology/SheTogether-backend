import { prisma } from '../config/db.js';
import { DEFAULT_SETTINGS } from '../config/policy.js';
import { TtlCache } from '../utils/cache.js';
import { unavailable } from '../utils/errors.js';

const cache = new TtlCache(30_000, 1);
const KEY = 'all';

export async function allSettings() {
  let s = cache.get(KEY);
  if (!s) {
    const rows = await prisma.systemSetting.findMany();
    s = { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
    cache.set(KEY, s);
  }
  return s;
}
export const getSetting = async (key) => (await allSettings())[key];
export const clearSettingsCache = () => cache.clear();

/** Feature kill-switch: throws 503 when an admin has disabled the feature. */
export async function requireEnabled(key, what) {
  if (!(await getSetting(key))) throw unavailable(`${what} is temporarily disabled`, 'FEATURE_DISABLED');
}
