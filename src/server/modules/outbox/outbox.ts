import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Transactional outbox: state changes and the outbox record are persisted in the same transaction;
 * the worker processes downstream effects with retries. Idempotency keys make replays harmless.
 */
export async function enqueueOutbox(db: Db, topic: string, payload: Record<string, unknown>, idempotencyKey: string, correlationId?: string | null) {
  const existing = await db.outboxMessage.findUnique({ where: { idempotencyKey } });
  if (existing) return { message: existing, duplicate: true };
  const message = await db.outboxMessage.create({ data: { topic, payload: payload as Prisma.InputJsonValue, idempotencyKey, correlationId: correlationId ?? null } });
  return { message, duplicate: false };
}
