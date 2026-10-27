import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { applyConfirmedState } from "@/server/modules/dialer/agentSessionService";
import { conflict, notFound } from "@/server/errors";

const schema = z.object({ interactionId: z.string(), action: z.enum(["RETRY_PROVIDER_WRAPUP", "RECONCILE_MANUALLY"]), reason: z.string().min(3).max(300) });

/**
 * Supervisor assistance for a stuck wrap-up: retry the provider command idempotently, or record a manual
 * reconciliation (provider state confirmed out of band) with a reason. The agent's saved outcome is never altered.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser("operations.manage");
    const { interactionId, action, reason } = await parseBody(req, schema);
    const i = await prisma.interaction.findUnique({ where: { id: interactionId }, include: { reservation: true } });
    if (!i) throw notFound("Interaction not found");
    if (i.status === "DRAFT" || i.status === "OPEN") throw conflict("The agent has not saved the outcome yet; a supervisor cannot save it on their behalf");
    const t = await now();
    if (action === "RETRY_PROVIDER_WRAPUP") {
      const r = await prisma.outboxMessage.updateMany({ where: { idempotencyKey: `wrapup:${interactionId}`, status: { in: ["FAILED", "DEAD"] } }, data: { status: "PENDING", nextAttemptAt: new Date(), attempts: 0, lastError: `Supervisor retry: ${reason}` } });
      await appendAudit(prisma, { actorUserId: user.id, action: "wrapup.supervisor_retry", objectType: "Interaction", objectId: interactionId, customerId: i.customerId, reason });
      return ok({ requeued: r.count });
    }
    await prisma.interaction.update({ where: { id: interactionId }, data: { wrapUpStatus: "ACKNOWLEDGED", wrapUpAckAt: t, wrapUpReceiptId: `manual:${user.id}:${t.getTime()}` } });
    await prisma.outboxMessage.updateMany({ where: { idempotencyKey: `wrapup:${interactionId}` }, data: { status: "DONE", processedAt: t, lastError: `Manually reconciled by supervisor: ${reason}` } });
    if (i.reservationId) await prisma.routingReservation.update({ where: { id: i.reservationId }, data: { status: "RELEASED", releasedAt: t, releaseReason: "MANUAL_RECONCILIATION" } });
    if (i.reservation?.agentSessionId) {
      await prisma.agentSession.update({ where: { id: i.reservation.agentSessionId }, data: { currentReservationId: null, currentInteractionId: null, requestedState: "NOT_READY" } });
      await applyConfirmedState(prisma, i.reservation.agentSessionId, "NOT_READY", t, { reason: "Wrap-up reconciled manually by supervisor; confirm Ready to resume" });
    }
    await prisma.exceptionCase.updateMany({ where: { dedupKey: `WRAPUP_FAILURE:${interactionId}` }, data: { status: "RESOLVED", resolution: `Manual reconciliation: ${reason}`, resolvedBy: user.id, resolvedAt: t } });
    await appendAudit(prisma, { actorUserId: user.id, action: "wrapup.manual_reconciliation", objectType: "Interaction", objectId: interactionId, customerId: i.customerId, reason });
    return ok({ reconciled: true });
  } catch (e) {
    return fail(e);
  }
}
