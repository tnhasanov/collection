import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { notFound } from "@/server/errors";

/** Controlled replay of a dead-lettered outbox message. Idempotency keys guarantee no duplicate send/apply. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("integration.operate");
    const { id } = await ctx.params;
    const m = await prisma.outboxMessage.findUnique({ where: { id } });
    if (!m) throw notFound("Outbox message not found");
    await prisma.outboxMessage.update({ where: { id }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: `Replayed by ${user.username}` } });
    await appendAudit(prisma, { actorUserId: user.id, action: "outbox.replayed", objectType: "OutboxMessage", objectId: id, changes: { topic: m.topic, idempotencyKey: m.idempotencyKey } });
    return ok({ replayed: true });
  } catch (e) {
    return fail(e);
  }
}
