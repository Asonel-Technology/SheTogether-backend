import { z } from 'zod';
import { AGE_BANDS, LANGUAGES, MIN_AGE, MAX_AGE } from '../config/policy.js';

export const uuid = z.uuid();
export const idParams = z.object({ id: uuid });
export const ageBand = z.enum(AGE_BANDS);
export const language = z.enum(LANGUAGES);
export const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const cursorQuery = z.object({
  cursor: uuid.optional().describe('Opaque cursor: the `nextCursor` of the previous page'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const paginate = ({ page, limit }) => ({ skip: (page - 1) * limit, take: limit, page, limit });
export const pageMeta = (total, { page, limit }) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });

/** Prisma cursor-pagination args for tables ordered by (time-ordered uuidv7) id desc. */
export const cursorArgs = ({ cursor, limit }, dir = 'desc') => ({
  take: limit + 1,
  orderBy: { id: dir },
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});
export function cursorResult(rows, { limit }) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, meta: { limit, nextCursor: hasMore ? items[items.length - 1].id : null } };
}

export const bandRange = (s) =>
  s.refine((v) => AGE_BANDS.indexOf(v.minAgeBand) <= AGE_BANDS.indexOf(v.maxAgeBand), {
    message: 'minAgeBand must not be older than maxAgeBand',
    path: ['minAgeBand'],
  });

/** Age is supplied as `age` OR `dateOfBirth`; only the derived age band is ever stored. */
export const ageInput = {
  age: z.number().int().min(MIN_AGE).max(MAX_AGE).optional().meta({ example: 17 }),
  dateOfBirth: z.iso.date().optional().meta({ example: '2008-05-14' }),
};
export const hasAgeInput = (v) => (v.age !== undefined) !== (v.dateOfBirth !== undefined);
export const ageInputMessage = { message: 'Provide exactly one of `age` or `dateOfBirth`', path: ['age'] };

export const text = (min, max) => z.string().trim().min(min).max(max);
export const slugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100);
