import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Db } from "@/server/db";
import { bakuBusinessDate, fromDbDate, isIsoDate, toDbDate } from "@/server/dates";
import { dec, money, toDbMoney } from "@/server/money";
import { recomputeLoanState } from "@/server/modules/finance/loanState";
import { syncCustomerCase } from "@/server/modules/cases/caseService";
import { attributePaymentToPromise, reversePromiseAttribution } from "@/server/modules/promises/promiseService";
import { invalidateObsoleteWork, refreshWorkItemEligibility, syncRoutineWorkItem } from "@/server/modules/work/workItemService";
import { appendAudit } from "@/server/modules/audit/audit";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import type { ActionCode } from "@/server/modules/decisions/treatment";

/** Application event contract (proposed; not a real ATB endpoint). */
export const integrationEventSchema = z.object({
  schemaVersion: z.string().default("1.0"),
  eventId: z.string().min(1),
  eventType: z.enum(["payment.posted", "payment.reversed", "loan.balance.snapshot", "customer.contact.updated"]),
  sourceSystem: z.string().min(1),
  sourceEventId: z.string().min(1),
  sourceVersion: z.string().default("1"),
  occurredAt: z.string().datetime({ offset: true }),
  receivedAt: z.string().datetime({ offset: true }).optional(),
  businessDate: z.string().optional(),
  customerId: z.string().optional().nullable(),
  loanId: z.string().optional().nullable(),
  correlationId: z.string().optional().nullable(),
  payload: z.record(z.string(), z.unknown()),
});
export type IntegrationEventInput = z.infer<typeof integrationEventSchema>;

export interface IngestResult {
  status: "PROCESSED" | "DUPLICATE" | "QUARANTINED" | "REJECTED" | "SUPERSEDED";
  integrationEventId: string;
  paymentId?: string;
  loanId?: string | null;
  customerId?: string | null;
  effects?: Record<string, unknown>;
  message?: string;
}

async function resolveLoan(db: Db, ref: string | null | undefined) {
  if (!ref) return null;
  return (await db.loan.findUnique({ where: { coreLoanId: ref } })) ?? (await db.loan.findUnique({ where: { id: ref } }));
}

/**
 * Idempotent integration-event ingestion. (sourceSystem, sourceEventId, eventType) is unique; a replay is a
 * DUPLICATE with no effect. Only verified postings change financial state; derived views are restated from facts.
 */
export async function ingestIntegrationEvent(prisma: PrismaClient, raw: unknown, now: Date): Promise<IngestResult> {
  const input = integrationEventSchema.parse(raw);
  const existing = await prisma.integrationEvent.findUnique({ where: { sourceSystem_sourceEventId_eventType: { sourceSystem: input.sourceSystem, sourceEventId: input.sourceEventId, eventType: input.eventType } } });
  if (existing) {
    await appendAudit(prisma, { actorService: "ingestion", action: "integration.event.duplicate", objectType: "IntegrationEvent", objectId: existing.id, sourceEventId: input.sourceEventId, correlationId: input.correlationId ?? null, changes: { eventType: input.eventType, note: "Replay ignored; no duplicate effect" } });
    return { status: "DUPLICATE", integrationEventId: existing.id, paymentId: (existing.resultJson as { paymentId?: string } | null)?.paymentId, message: "Event already processed; replay produced no effect" };
  }
  const businessDate = input.businessDate && isIsoDate(input.businessDate) ? input.businessDate : bakuBusinessDate(now);
  const event = await prisma.integrationEvent.create({
    data: { schemaVersion: input.schemaVersion, eventId: input.eventId, eventType: input.eventType, sourceSystem: input.sourceSystem, sourceEventId: input.sourceEventId, sourceVersion: input.sourceVersion, occurredAt: new Date(input.occurredAt), receivedAt: input.receivedAt ? new Date(input.receivedAt) : now, businessDate: toDbDate(businessDate), customerRef: input.customerId ?? null, loanRef: input.loanId ?? null, payload: input.payload as never, correlationId: input.correlationId ?? null },
  });
  const finish = async (status: IngestResult["status"], result: Record<string, unknown>, error?: string): Promise<IngestResult> => {
    await prisma.integrationEvent.update({ where: { id: event.id }, data: { status, processedAt: now, resultJson: result as never, errorMessage: error } });
    return { status, integrationEventId: event.id, ...result, message: error };
  };

  try {
    switch (input.eventType) {
      case "payment.posted": {
        const amount = money(String(input.payload.amount ?? "0"));
        const currency = String(input.payload.currency ?? "AZN");
        const valueDate = String(input.payload.valueDate ?? businessDate);
        const txnId = String(input.payload.transactionId ?? input.sourceEventId);
        if (!amount.greaterThan(0) || currency !== "AZN" || !isIsoDate(valueDate)) return finish("REJECTED", {}, "Invalid amount, currency or value date");
        const loan = await resolveLoan(prisma, input.loanId ?? (input.payload.loanRef as string | undefined));
        if (!loan) {
          const q = await prisma.payment.upsert({
            where: { sourceSystem_sourceTransactionId: { sourceSystem: input.sourceSystem, sourceTransactionId: txnId } },
            create: { sourceSystem: input.sourceSystem, sourceTransactionId: txnId, loanRef: input.loanId ?? null, customerRef: input.customerId ?? null, amount: toDbMoney(amount), currency, eventAt: new Date(input.occurredAt), valueDate: toDbDate(valueDate), status: "QUARANTINED", reconciliation: "UNMATCHED", reconciliationNote: "Loan reference not found", integrationEventId: event.id },
            update: {},
          });
          await prisma.exceptionCase.upsert({ where: { dedupKey: `UNMATCHED_PAYMENT:${q.id}` }, create: { dedupKey: `UNMATCHED_PAYMENT:${q.id}`, type: "UNMATCHED_PAYMENT", severity: "WARNING", paymentId: q.id, title: `Posted payment ${amount.toFixed(2)} AZN has no matching loan reference (${input.loanId ?? "none"})`, evidence: { sourceEventId: input.sourceEventId } as never }, update: { lastSeenAt: now } });
          return finish("QUARANTINED", { paymentId: q.id }, "Loan reference not found; payment quarantined for review");
        }
        const dup = await prisma.payment.findUnique({ where: { sourceSystem_sourceTransactionId: { sourceSystem: input.sourceSystem, sourceTransactionId: txnId } } });
        if (dup) return finish("DUPLICATE", { paymentId: dup.id, loanId: loan.id, customerId: loan.customerId }, "Business reference already posted; duplicate ignored");
        const effects = await prisma.$transaction(async (tx: Db) => {
          const payment = await tx.payment.create({ data: { sourceSystem: input.sourceSystem, sourceTransactionId: txnId, loanId: loan.id, customerId: loan.customerId, loanRef: loan.coreLoanId, customerRef: loan.customerId, amount: toDbMoney(amount), currency, eventAt: new Date(input.occurredAt), valueDate: toDbDate(valueDate), postingDate: toDbDate(valueDate), status: "POSTED", reconciliation: "MATCHED", integrationEventId: event.id, allocationPolicy: "DEMO_OLDEST_DUE_FIRST_INTEREST_THEN_PRINCIPAL" } });
          const loanState = await recomputeLoanState(tx, loan.id, businessDate, { reason: `payment.posted ${txnId}`, sourceEventId: input.sourceEventId, asOf: now });
          const caseState = await syncCustomerCase(tx, loan.customerId, now, { actorService: "ingestion", sourceEventId: input.sourceEventId });
          const promise = await attributePaymentToPromise(tx, { id: payment.id, customerId: loan.customerId, loanId: loan.id, amount: amount.toFixed(2), eventAt: new Date(input.occurredAt), status: "POSTED" }, now);
          let work: { cancelled: string[]; withdrawals: string[] } = { cancelled: [], withdrawals: [] };
          const stillInArrears = caseState.status === "OPEN" || caseState.status === "HANDOVER";
          if (!stillInArrears) {
            work = await invalidateObsoleteWork(tx, loan.customerId, "PAID_ARREARS_CLEARED", now, { sourceEventId: input.sourceEventId, correlationId: input.correlationId ?? null });
          } else {
            const open = await tx.workItem.findMany({ where: { customerId: loan.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
            for (const wi of open) await refreshWorkItemEligibility(tx, wi.id, now);
            const connected = await tx.routingReservation.findFirst({ where: { customerId: loan.customerId, status: { in: ["CONNECTED", "WRAP_UP"] } } });
            if (connected) await enqueueOutbox(tx, "agent.notify", { agentUserId: connected.agentUserId, reservationId: connected.id, kind: "PAYMENT_DURING_CALL", message: `Verified payment ${amount.toFixed(2)} AZN posted on ${loan.coreLoanId}; balances refreshed (overdue now ${loanState.totalOverdue}).` }, `notify:${connected.id}:${input.sourceEventId}`, input.correlationId ?? null);
          }
          await tx.sourceWatermark.updateMany({ where: { sourceSystem: "PAYMENT_FEED" }, data: { lastSuccessfulRunAt: now, sourceAsOf: now, lagSeconds: 0, health: "HEALTHY" } });
          await appendAudit(tx, { actorService: "ingestion", action: "payment.posted", objectType: "Payment", objectId: payment.id, customerId: loan.customerId, caseId: caseState.caseId, sourceEventId: input.sourceEventId, correlationId: input.correlationId ?? null, changes: { amount: amount.toFixed(2), loan: loanState, case: caseState, promise, work } });
          return { paymentId: payment.id, loanId: loan.id, customerId: loan.customerId, loan: loanState, case: caseState, promise, work };
        });
        return finish("PROCESSED", effects);
      }
      case "payment.reversed": {
        const originalRef = String(input.payload.reversalOf ?? input.payload.originalTransactionId ?? "");
        const original = await prisma.payment.findUnique({ where: { sourceSystem_sourceTransactionId: { sourceSystem: input.sourceSystem, sourceTransactionId: originalRef } } });
        if (!original) return finish("QUARANTINED", {}, `Original payment ${originalRef} not found`);
        if (original.status === "REVERSED") return finish("DUPLICATE", { paymentId: original.id }, "Already reversed");
        const txnId = String(input.payload.transactionId ?? input.sourceEventId);
        const effects = await prisma.$transaction(async (tx: Db) => {
          await tx.payment.update({ where: { id: original.id }, data: { status: "REVERSED", reconciliation: "REVERSAL_LINKED", reconciliationNote: `Reversed by ${txnId}` } });
          const reversal = await tx.payment.create({ data: { sourceSystem: input.sourceSystem, sourceTransactionId: txnId, loanId: original.loanId, customerId: original.customerId, loanRef: original.loanRef, customerRef: original.customerRef, amount: dec(original.amount).negated().toFixed(2), currency: original.currency, eventAt: new Date(input.occurredAt), valueDate: toDbDate(String(input.payload.valueDate ?? businessDate)), status: "REVERSED", reconciliation: "REVERSAL_LINKED", reversalOfId: original.id, integrationEventId: event.id } });
          let loanState = null;
          let caseState = null;
          let resync: unknown = null;
          if (original.loanId && original.customerId) {
            loanState = await recomputeLoanState(tx, original.loanId, businessDate, { reason: `payment.reversed ${txnId}`, sourceEventId: input.sourceEventId, asOf: now });
            caseState = await syncCustomerCase(tx, original.customerId, now, { actorService: "ingestion", sourceEventId: input.sourceEventId });
            resync = await resyncRoutineWork(tx, original.customerId, now);
          }
          const promise = await reversePromiseAttribution(tx, original.id, now);
          await tx.exceptionCase.upsert({ where: { dedupKey: `REVERSED_PAYMENT:${original.id}` }, create: { dedupKey: `REVERSED_PAYMENT:${original.id}`, type: "REVERSED_PAYMENT", severity: "WARNING", customerId: original.customerId, loanId: original.loanId, paymentId: original.id, title: `Payment ${original.sourceTransactionId} (${dec(original.amount).toFixed(2)} AZN) reversed; arrears reassessed`, evidence: { reversalTransactionId: txnId } as never }, update: { lastSeenAt: now } });
          await appendAudit(tx, { actorService: "ingestion", action: "payment.reversed", objectType: "Payment", objectId: reversal.id, customerId: original.customerId, sourceEventId: input.sourceEventId, changes: { originalPaymentId: original.id, loan: loanState, case: caseState, promise, resync } });
          return { paymentId: reversal.id, loanId: original.loanId, customerId: original.customerId, loan: loanState, case: caseState, promise };
        });
        return finish("PROCESSED", effects);
      }
      case "loan.balance.snapshot": {
        const loan = await resolveLoan(prisma, input.loanId);
        if (!loan) return finish("QUARANTINED", {}, "Loan reference not found");
        // Out-of-order guard: a snapshot older than the current source version never overwrites newer state.
        if (Number(input.sourceVersion) < Number(loan.sourceVersion)) return finish("SUPERSEDED", { loanId: loan.id }, `Snapshot version ${input.sourceVersion} is older than current ${loan.sourceVersion}`);
        await prisma.loan.update({ where: { id: loan.id }, data: { balancesAsOf: new Date(input.occurredAt), sourceVersion: input.sourceVersion } });
        await prisma.sourceWatermark.updateMany({ where: { sourceSystem: "CORE_BANKING" }, data: { lastSuccessfulRunAt: now, sourceAsOf: new Date(input.occurredAt), lagSeconds: Math.max(0, Math.round((now.getTime() - new Date(input.occurredAt).getTime()) / 1000)), health: "HEALTHY" } });
        return finish("PROCESSED", { loanId: loan.id, customerId: loan.customerId });
      }
      case "customer.contact.updated": {
        const customer = input.customerId ? await prisma.customer.findUnique({ where: { id: input.customerId } }) : null;
        if (!customer) return finish("QUARANTINED", {}, "Customer not found");
        const value = String(input.payload.value ?? "");
        const type = (String(input.payload.type ?? "MOBILE") as "MOBILE" | "LANDLINE" | "EMAIL" | "ADDRESS");
        const cp = await prisma.contactPoint.create({ data: { customerId: customer.id, type, value, verification: input.payload.verified ? "VERIFIED" : "UNVERIFIED", isPrimary: !!input.payload.primary, sourceSystem: input.sourceSystem, sourceAsOf: new Date(input.occurredAt) } });
        return finish("PROCESSED", { customerId: customer.id, contactPointId: cp.id });
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.integrationEvent.update({ where: { id: event.id }, data: { status: "FAILED", errorMessage: message, processedAt: now } });
    throw e;
  }
}

/** After a reversal re-opens arrears intraday, re-create the routine work item from the latest snapshot. */
export async function resyncRoutineWork(db: Db, customerId: string, now: Date) {
  const c = await db.collectionCase.findFirst({ where: { customerId, status: "OPEN" } });
  if (!c) return null;
  const snapshot = await db.decisionSnapshot.findFirst({ where: { customerId }, orderBy: { createdAt: "desc" } });
  if (!snapshot) return null;
  const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
  const wi = await syncRoutineWorkItem(db, { customerId, caseId: c.id, snapshotId: snapshot.id, effectiveAction: snapshot.effectiveAction as ActionCode, era: snapshot.era ? snapshot.era.toString() : null, rank: snapshot.rank, requiredSkill: snapshot.requiredSkill, language: customer.language, campaignCode: snapshot.effectiveAction.includes("CALL") ? "SOFT_COLLECTIONS_VOICE" : null, now });
  if (wi) await refreshWorkItemEligibility(db, wi.id, now);
  return wi ? { workItemId: wi.id, type: wi.type } : null;
}

/** DEMO-only simulator helpers (never available in INTEGRATION mode; the API enforces this). */
export function buildSimulatedPaymentEvent(params: { loanRef: string; amount: string; valueDate?: string; transactionId?: string; now: Date; customerId?: string | null }) {
  const txn = params.transactionId ?? `SIM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    schemaVersion: "1.0",
    eventId: `demo-event-${txn}`,
    eventType: "payment.posted" as const,
    sourceSystem: "CORE_DEMO",
    sourceEventId: txn,
    sourceVersion: "1",
    occurredAt: params.now.toISOString(),
    businessDate: params.valueDate ?? bakuBusinessDate(params.now),
    customerId: params.customerId ?? null,
    loanId: params.loanRef,
    payload: { amount: params.amount, currency: "AZN", valueDate: params.valueDate ?? bakuBusinessDate(params.now), status: "POSTED", transactionId: txn },
  };
}

export function buildSimulatedReversalEvent(params: { originalTransactionId: string; now: Date; loanRef?: string | null }) {
  const txn = `REV-${params.originalTransactionId}`;
  return {
    schemaVersion: "1.0",
    eventId: `demo-event-${txn}`,
    eventType: "payment.reversed" as const,
    sourceSystem: "CORE_DEMO",
    sourceEventId: txn,
    sourceVersion: "1",
    occurredAt: params.now.toISOString(),
    businessDate: bakuBusinessDate(params.now),
    loanId: params.loanRef ?? null,
    payload: { reversalOf: params.originalTransactionId, transactionId: txn, valueDate: bakuBusinessDate(params.now) },
  };
}

export { fromDbDate };
