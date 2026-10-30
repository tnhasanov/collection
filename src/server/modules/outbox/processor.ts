import type { PrismaClient } from "@/generated/prisma/client";
import type { DialerAdapter } from "@/server/modules/dialer/contract";
import { handleDialerOutbox } from "@/server/modules/dialer/runtime";
import type { ScheduleEvents } from "@/server/modules/dialer/routingService";
import { failCommand } from "@/server/modules/dialer/callControlService";

/** Processes pending outbox messages with bounded retries, backoff and dead-letter visibility. */
export async function processOutbox(prisma: PrismaClient, adapter: DialerAdapter, scheduleEvents: ScheduleEvents, now: Date, limit = 20) {
  const pending = await prisma.outboxMessage.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  for (const m of pending) {
    const claimed = await prisma.outboxMessage.updateMany({ where: { id: m.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
    if (claimed.count === 0) continue;
    try {
      const r = await handleDialerOutbox(prisma, adapter, m, now, scheduleEvents);
      if (r.done) {
        await prisma.outboxMessage.update({ where: { id: m.id }, data: { status: "DONE", processedAt: new Date(), lastError: r.note ?? null } });
      } else {
        const attempts = m.attempts + 1;
        const dead = attempts >= m.maxAttempts;
        await prisma.outboxMessage.update({ where: { id: m.id }, data: { status: dead ? "DEAD" : "FAILED", lastError: r.note ?? "retry", nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2_000 * 2 ** attempts)) } });
        if (dead) await onDeadLetter(prisma, m, r.note ?? "retry", now);
      }
    } catch (e) {
      const attempts = m.attempts + 1;
      const dead = attempts >= m.maxAttempts;
      await prisma.outboxMessage.update({ where: { id: m.id }, data: { status: dead ? "DEAD" : "FAILED", lastError: String(e).slice(0, 500), nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2_000 * 2 ** attempts)) } });
      if (dead) await onDeadLetter(prisma, m, String(e).slice(0, 300), now).catch(() => null);
      console.error(`[outbox] ${m.topic} failed`, e);
    }
  }
  return pending.length;
}


/** A dead-lettered provider command must never stay "pending" on the agent screen: its command becomes FAILED. */
async function onDeadLetter(prisma: PrismaClient, m: { topic: string; payload: unknown; idempotencyKey: string; attempts: number }, error: string, now: Date) {
  if (m.topic !== "dialer.callControl" && m.topic !== "dialer.reconcileInteraction") return;
  const interactionId = (m.payload as { interactionId?: string } | null)?.interactionId;
  if (!interactionId) return;
  await failCommand(prisma, interactionId, m.idempotencyKey, `Provider did not answer after ${m.attempts + 1} attempts: ${error}`, now);
}
