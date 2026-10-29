import type { Db } from "@/server/db";
import { bakuBusinessDate, toDbDate } from "@/server/dates";
import { dec, money, toDbMoney } from "@/server/money";
import { getSetting } from "@/server/modules/settings/settingsService";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * Versioned attribution of verified posted cash to agents. One attribution row per payment, written once when the
 * payment is ingested and marked reversed when the payment is reversed; every report (agent results, team grid,
 * analytics) reads these rows, so a payment can never be counted twice and attributed totals can never exceed the
 * eligible posted cash of the period.
 *
 * Rule ATTRIB-1 (demo assumption, pending bank approval): a POSTED payment on a customer loan is attributed to the
 * agent of the customer's most recent verified right-party conversation that ended at or before the payment event
 * and no more than `attribution.windowDays` days earlier. Competing agents: the latest verified conversation wins,
 * never both. No qualifying conversation → the payment stays unattributed (counted as portfolio cash only).
 * Reporting date = Baku business date of the payment event.
 */
export const ATTRIBUTION_RULE_VERSION = "ATTRIB-1";
export const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 10;

export interface AttributablePayment {
  id: string;
  customerId: string | null;
  loanId: string | null;
  amount: string | { toString(): string };
  eventAt: Date;
  status: string;
}

export async function attributionWindowDays(db: Db): Promise<number> {
  const v = await getSetting<number>("attribution.windowDays", db).catch(() => null);
  return typeof v === "number" && v > 0 ? v : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
}

export async function attributePaymentToAgent(db: Db, payment: AttributablePayment, now: Date) {
  if (!payment.customerId || payment.status !== "POSTED") return null;
  const existing = await db.paymentAttribution.findUnique({ where: { paymentId: payment.id } });
  if (existing) return { id: existing.id, agentUserId: existing.agentUserId, amount: existing.amount.toString(), duplicate: true, ruleVersion: existing.ruleVersion };
  const windowDays = await attributionWindowDays(db);
  const windowStart = new Date(payment.eventAt.getTime() - windowDays * 86_400_000);
  const candidates = await db.interaction.findMany({
    where: { customerId: payment.customerId, isRpc: true, status: { in: ["SAVED", "CORRECTED"] }, agentUserId: { not: null }, startedAt: { gte: windowStart, lte: payment.eventAt } },
    orderBy: [{ connectedAt: "desc" }, { startedAt: "desc" }],
    take: 5,
    select: { id: true, agentUserId: true, connectedAt: true, startedAt: true },
  });
  const latest = candidates.find((c) => (c.connectedAt ?? c.startedAt).getTime() <= payment.eventAt.getTime()) ?? null;
  const amount = money(dec(payment.amount.toString()));
  const row = await db.paymentAttribution.create({
    data: {
      paymentId: payment.id,
      customerId: payment.customerId,
      agentUserId: latest?.agentUserId ?? null,
      interactionId: latest?.id ?? null,
      ruleVersion: ATTRIBUTION_RULE_VERSION,
      amount: toDbMoney(amount),
      reportingDate: toDbDate(bakuBusinessDate(payment.eventAt)),
      attributedAt: now,
      reason: latest ? `Latest verified conversation within ${windowDays} days` : "No verified conversation within the attribution window",
    },
  });
  await appendAudit(db, { actorService: "attribution", action: latest ? "payment.attributed" : "payment.unattributed", objectType: "Payment", objectId: payment.id, customerId: payment.customerId, changes: { agentUserId: latest?.agentUserId ?? null, interactionId: latest?.id ?? null, amount: amount.toFixed(2), ruleVersion: ATTRIBUTION_RULE_VERSION } });
  return { id: row.id, agentUserId: row.agentUserId, amount: amount.toFixed(2), duplicate: false, ruleVersion: ATTRIBUTION_RULE_VERSION };
}

/** A reversal removes the credit from every report; the row stays as history. */
export async function reverseAgentAttribution(db: Db, originalPaymentId: string, reversalPaymentId: string, now: Date) {
  const existing = await db.paymentAttribution.findUnique({ where: { paymentId: originalPaymentId } });
  if (!existing || existing.reversedAt) return null;
  await db.paymentAttribution.update({ where: { id: existing.id }, data: { reversedAt: now, reversalPaymentId } });
  await appendAudit(db, { actorService: "attribution", action: "payment.attribution_reversed", objectType: "Payment", objectId: originalPaymentId, customerId: existing.customerId, changes: { agentUserId: existing.agentUserId, amount: existing.amount.toString(), reversalPaymentId } });
  return { id: existing.id, agentUserId: existing.agentUserId };
}

/** Sum of non-reversed attributions for one agent whose reporting date falls in [from, to] (Baku dates inclusive). */
export async function attributedCashForAgent(db: Db, agentUserId: string, range: { from: Date; to: Date }) {
  const rows = await db.paymentAttribution.findMany({ where: { agentUserId, reversedAt: null, reportingDate: { gte: toDbDate(bakuBusinessDate(range.from)), lte: toDbDate(bakuBusinessDate(range.to)) } }, select: { amount: true } });
  return money(rows.reduce((s, r) => s.plus(r.amount.toString()), dec(0))).toFixed(2);
}

/** Per-agent totals for a period (team grid, analytics); unattributed cash is reported under the null key. */
export async function attributedCashByAgent(db: Db, range: { from: Date; to: Date }) {
  const rows = await db.paymentAttribution.groupBy({ by: ["agentUserId"], where: { reversedAt: null, reportingDate: { gte: toDbDate(bakuBusinessDate(range.from)), lte: toDbDate(bakuBusinessDate(range.to)) } }, _sum: { amount: true } });
  const map = new Map<string | null, string>();
  for (const r of rows) map.set(r.agentUserId, money(dec(r._sum.amount?.toString() ?? "0")).toFixed(2));
  return map;
}

/** Idempotent backfill for payments posted before attribution existed (worker catch-up). */
export async function backfillAttributions(db: Db, now: Date, batch = 500, maxBatches = 200) {
  let processed = 0;
  let attributed = 0;
  for (let i = 0; i < maxBatches; i++) {
    const missing = await db.payment.findMany({ where: { status: "POSTED", customerId: { not: null }, attribution: null }, orderBy: { eventAt: "asc" }, take: batch, select: { id: true, customerId: true, loanId: true, amount: true, eventAt: true, status: true } });
    if (missing.length === 0) break;
    for (const p of missing) {
      const r = await attributePaymentToAgent(db, { ...p, amount: p.amount.toString() }, now);
      processed++;
      if (r?.agentUserId) attributed++;
    }
    if (missing.length < batch) break;
  }
  return { processed, attributed };
}
