// Scheduled housekeeping (run daily: cron, Azure WebJob/Container job, GitHub Action, Render cron…).
//   npm run maintenance
import { prisma } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { destroyRemote } from '../src/services/media.service.js';

const day = 86_400_000;
const ago = (days) => new Date(Date.now() - days * day);
const report = {};

// Expired / revoked credentials
report.refreshTokens = (await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: ago(7) } }] } })).count;
report.otpCodes = (await prisma.otpCode.deleteMany({ where: { expiresAt: { lt: ago(1) } } })).count;

// Privacy retention: chat messages, analytics events
report.chatMessages = (await prisma.chatMessage.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
report.analyticsEvents = (await prisma.analyticsEvent.deleteMany({ where: { createdAt: { lt: ago(env.ANALYTICS_RETENTION_DAYS) } } })).count;

// Vectors of superseded knowledge versions (kept 30 days for audit/rollback, then removed)
report.inactiveChunks = (await prisma.knowledgeChunk.deleteMany({ where: { active: false, createdAt: { lt: ago(30) } } })).count;

// Moderated media that has been disabled for 30+ days
const media = await prisma.mediaAsset.findMany({ where: { status: 'DISABLED', createdAt: { lt: ago(30) } }, select: { id: true, publicId: true, resourceType: true }, take: 200 });
for (const m of media) await destroyRemote(m.publicId, m.resourceType);
report.disabledMedia = (await prisma.mediaAsset.deleteMany({ where: { id: { in: media.map((m) => m.id) } } })).count;

// Accounts whose deletion grace period has passed: cascades profile, tokens, posts, comments, saved items, follows…
const due = await prisma.user.findMany({ where: { status: 'PENDING_DELETION', deletionRequestedAt: { lt: ago(env.ACCOUNT_DELETION_GRACE_DAYS) } }, select: { id: true }, take: 200 });
const ids = due.map((u) => u.id);
if (ids.length) {
  await prisma.reaction.deleteMany({ where: { userId: { in: ids } } });
  report.deletedAccounts = (await prisma.user.deleteMany({ where: { id: { in: ids } } })).count;
}

console.log(JSON.stringify({ maintenance: 'done', ...report }));
await prisma.$disconnect();
