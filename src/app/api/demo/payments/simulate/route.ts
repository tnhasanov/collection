import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser, isSyntheticMode } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { addHours, bakuBusinessDate, toDbDate } from "@/server/dates";
import { buildSimulatedPaymentEvent, buildSimulatedReversalEvent, ingestIntegrationEvent } from "@/server/modules/payments/paymentService";
import { forbidden, notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";
import { ensureTaskWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { getContactPolicy } from "@/server/modules/settings/settingsService";

const schema = z.object({
  kind: z.enum(["POST", "REPLAY", "REVERSE", "LATE", "CLAIM_ONLY"]),
  loanRef: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  valueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  transactionId: z.string().optional(),
});

/**
 * Synthetic payment injection for DEMO and PILOT environments (refused in INTEGRATION mode). Uses the same
 * idempotent ingestion as the real feed and respects the caller's customer scope.
 */
export async function POST(req: Request) {
  try {
    if (!isSyntheticMode()) throw forbidden("Payment simulation is disabled outside synthetic environments (DEMO or PILOT)");
    const user = await requireUser("payment.simulate");
    const input = await parseBody(req, schema);
    const t = await now();
    await appendAudit(prisma, { actorUserId: user.id, action: "demo.payment.simulated", objectType: "Payment", changes: input });
    if (input.kind === "REVERSE") {
      if (!input.transactionId) throw notFound("transactionId of the original payment is required");
      const original = await prisma.payment.findFirst({ where: { sourceTransactionId: input.transactionId } });
      if (original?.customerId) await requireCustomerAccess(prisma, user, original.customerId);
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
    if (!input.loanRef) throw notFound("loanRef is required");
    const loan = (await prisma.loan.findUnique({ where: { coreLoanId: input.loanRef } })) ?? (await prisma.loan.findUnique({ where: { id: input.loanRef } }));
    if (!loan) throw notFound("Loan not found");
    await requireCustomerAccess(prisma, user, loan.customerId);
    if (input.kind === "CLAIM_ONLY") {
      // "Customer says paid" without any posting: a claim, a reconciliation task and a hold; balances untouched.
      const policy = await getContactPolicy(prisma);
      const holdUntil = addHours(t, policy.paidClaimHoldHours);
      const c = await prisma.collectionCase.findFirst({ where: { customerId: loan.customerId, status: { in: ["OPEN", "HANDOVER"] } } });
      const claim = await prisma.paymentClaim.create({ data: { customerId: loan.customerId, loanId: loan.id, claimedAmount: input.amount ?? null, claimedDate: toDbDate(input.valueDate ?? bakuBusinessDate(t)), channel: "SIMULATOR", reference: input.transactionId ?? null, status: "OPEN", holdUntil } });
      if (c) await ensureTaskWorkItem(prisma, { customerId: loan.customerId, caseId: c.id, type: "RECONCILIATION", dueAt: holdUntil, ownerUserId: null, reason: `Simulated already-paid claim ${input.amount ?? "(amount unknown)"} on ${loan.coreLoanId}`, sourceInteractionId: null });
      await prisma.exceptionCase.upsert({ where: { dedupKey: `CLAIM:${claim.id}` }, create: { dedupKey: `CLAIM:${claim.id}`, type: "CLAIMED_ALREADY_PAID", severity: "WARNING", customerId: loan.customerId, caseId: c?.id ?? null, title: `Customer claims payment ${input.amount ?? ""} (simulator)`, evidence: { claimId: claim.id } as never, slaDueAt: holdUntil }, update: {} });
      const open = await prisma.workItem.findMany({ where: { customerId: loan.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
      for (const wi of open) await refreshWorkItemEligibility(prisma, wi.id, t);
      return ok({ status: "CLAIM_RECORDED", claimId: claim.id, holdUntil, note: "No posting was created: a claim never changes balances; the reconciliation task owns the follow-up." });
    }
    if (!input.amount) throw notFound("amount is required");
    const valueDate = input.kind === "LATE" ? input.valueDate ?? new Date(t.getTime() - 3 * 86400000).toISOString().slice(0, 10) : input.valueDate;
    const r = await ingestIntegrationEvent(prisma, buildSimulatedPaymentEvent({ loanRef: loan.coreLoanId, amount: input.amount, valueDate, transactionId: input.transactionId, now: t }), t);
    if (r.customerId) {
      const open = await prisma.workItem.findMany({ where: { customerId: r.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "DEFERRED"] } }, select: { id: true } });
      for (const wi of open) await refreshWorkItemEligibility(prisma, wi.id, t);
    }
    return ok(r);
  } catch (e) {
    return fail(e);
  }
}
