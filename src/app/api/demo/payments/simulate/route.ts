import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { buildSimulatedPaymentEvent, buildSimulatedReversalEvent, ingestIntegrationEvent } from "@/server/modules/payments/paymentService";
import { forbidden, notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";
import { refreshWorkItemEligibility } from "@/server/modules/work/workItemService";

const schema = z.object({
  kind: z.enum(["POST", "REPLAY", "REVERSE", "LATE", "CLAIM_ONLY"]),
  loanRef: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  transactionId: z.string().optional(),
});

/** DEMO-only synthetic payment injection. Refused outside DEMO mode. Uses the same idempotent ingestion as the real feed. */
export async function POST(req: Request) {
  try {
    if (process.env.APP_MODE !== "DEMO") throw forbidden("Payment simulation is disabled outside DEMO mode");
    const user = await requireUser("payment.simulate");
    const input = await parseBody(req, schema);
    const t = await now();
    await appendAudit(prisma, { actorUserId: user.id, action: "demo.payment.simulated", objectType: "Payment", changes: input });
    if (input.kind === "REVERSE") {
      if (!input.transactionId) throw notFound("transactionId of the original payment is required");
      const original = await prisma.payment.findFirst({ where: { sourceTransactionId: input.transactionId } });
      const r = await ingestIntegrationEvent(prisma, buildSimulatedReversalEvent({ originalTransactionId: input.transactionId, now: t, loanRef: original?.loanRef ?? null }), t);
      return ok(r);
    }
    if (input.kind === "REPLAY") {
      if (!input.transactionId) throw notFound("transactionId is required for a replay");
      const ev = await prisma.integrationEvent.findFirst({ where: { sourceEventId: input.transactionId, eventType: "payment.posted" } });
      if (!ev) throw notFound("No processed event with that transaction id");
      const r = await ingestIntegrationEvent(prisma, { schemaVersion: ev.schemaVersion, eventId: ev.eventId, eventType: "payment.posted", sourceSystem: ev.sourceSystem, sourceEventId: ev.sourceEventId, sourceVersion: ev.sourceVersion, occurredAt: ev.occurredAt.toISOString(), businessDate: ev.businessDate?.toISOString().slice(0, 10), customerId: ev.customerRef, loanId: ev.loanRef, payload: ev.payload }, t);
      return ok(r);
    }
    if (!input.loanRef || !input.amount) throw notFound("loanRef and amount are required");
    const valueDate = input.kind === "LATE" ? input.valueDate ?? new Date(t.getTime() - 3 * 86400000).toISOString().slice(0, 10) : input.valueDate;
    const r = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: input.loanRef, amount: input.amount, valueDate, transactionId: input.transactionId, now: t }), t);
    if (r.customerId) {
      const open = await prisma.workItem.findMany({ where: { customerId: r.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "DEFERRED"] } }, select: { id: true } });
      for (const wi of open) await refreshWorkItemEligibility(prisma, wi.id, t);
    }
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}
