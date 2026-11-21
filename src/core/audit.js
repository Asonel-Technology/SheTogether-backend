import { prisma } from '../config/db.js';

/** Write an audit log row. Pass `tx` to make it part of a transaction. */
export const audit = (actor, action, entityType, entityId, metadata, client = prisma) =>
  client.auditLog.create({
    data: { actorId: actor?.id ?? null, action, entityType, entityId: entityId ?? null, metadata: metadata ?? undefined },
    select: { id: true },
  });
