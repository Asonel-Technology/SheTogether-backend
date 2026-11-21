import { prisma } from '../config/db.js';

/** Privacy-first events: no user id, no IP, no free text. Age band/language come from the token, not the body. */
export async function ingest(user, events) {
  await prisma.analyticsEvent.createMany({
    data: events.map((e) => ({ eventType: e.type, topic: e.topic ?? null, sessionRef: e.sessionRef ?? null, ageBand: user?.ageBand ?? null, language: user?.preferredLanguage ?? e.language ?? null })),
  });
  return { accepted: events.length };
}

export async function summary({ from, to }) {
  const range = { gte: from, lte: to };
  const where = { createdAt: range };
  const [byType, byAge, byLanguage, topTopics, daily, feedback, chat, users] = await Promise.all([
    prisma.analyticsEvent.groupBy({ by: ['eventType'], where, _count: { _all: true } }),
    prisma.analyticsEvent.groupBy({ by: ['ageBand'], where, _count: { _all: true } }),
    prisma.analyticsEvent.groupBy({ by: ['language'], where, _count: { _all: true } }),
    prisma.analyticsEvent.groupBy({ by: ['topic'], where: { ...where, topic: { not: null }, eventType: { in: ['CONTENT_VIEW', 'CATEGORY_VIEW'] } }, _count: { _all: true }, orderBy: { _count: { topic: 'desc' } }, take: 10 }),
    prisma.$queryRaw`SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day, count(*)::int AS events FROM "analytics_events" WHERE "createdAt" BETWEEN ${from} AND ${to} GROUP BY 1 ORDER BY 1`,
    prisma.chatFeedback.groupBy({ by: ['rating'], where, _count: { _all: true } }),
    prisma.chatSession.groupBy({ by: ['safetyLevel'], where: { startedAt: range }, _count: { _all: true } }),
    prisma.user.groupBy({ by: ['ageBand'], _count: { _all: true } }),
  ]);
  const flat = (rows, key) => Object.fromEntries(rows.map((r) => [r[key] ?? 'unknown', r._count._all]));
  return {
    from, to,
    eventsByType: flat(byType, 'eventType'),
    eventsByAgeBand: flat(byAge, 'ageBand'),
    eventsByLanguage: flat(byLanguage, 'language'),
    topTopics: topTopics.map((t) => ({ topic: t.topic, views: t._count._all })),
    dailyEvents: daily,
    chatFeedback: flat(feedback, 'rating'),
    chatSessionsBySafetyLevel: flat(chat, 'safetyLevel'),
    registeredUsersByAgeBand: flat(users, 'ageBand'),
  };
}
