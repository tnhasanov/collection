import type { PrismaClient } from "@/generated/prisma/client";
import type { Rng } from "./rng";
import { buildAnnuitySchedule } from "@/server/modules/finance/annuity";
import { addDays, addMonthsClamped, bakuDateTime, toDbDate, type IsoDate } from "@/server/dates";
import { dec, money, toDbMoney } from "@/server/money";
import { DEMO_BUSINESS_DATE, DEMO_SEED_INSTANT } from "@/server/clock";

export const BUSINESS_DATE: IsoDate = DEMO_BUSINESS_DATE;
export const SEED_NOW = DEMO_SEED_INSTANT;
const BRANCHES = ["Baku-Nasimi", "Baku-Yasamal", "Baku-Khatai", "Sumgayit", "Ganja", "Baku-Sabail"];
const FIRST = ["Demo", "Synthetic", "Test", "Sample"];

export interface LoanSpec {
  id: string;
  coreLoanId?: string;
  customerId: string;
  branch: string;
  principal: string;
  rate: string; // fraction
  tenor: number;
  /** Target DPD on the business date (0 = current). */
  targetDpd: number;
  /** Installments paid before the first unpaid one. */
  paidInstallments: number;
  /** Optional partial payment of the oldest unpaid installment (fraction 0..1). */
  partialFraction?: number;
  /** Optional explicit first due date (overrides target computation). */
  firstDueDate?: IsoDate;
  paymentDay?: number;
  /** Optional: mark loan PAID_OFF via full early repayment. */
  paidOffEarly?: boolean;
  /** Optional extra payment records (for reversal / late feed scenarios). */
  extraPayments?: { amount: string; valueDate: IsoDate; eventAt?: Date; txnId: string; status?: "POSTED" | "REVERSED" | "PENDING" | "QUARANTINED" | "UNMATCHED"; reversalOfTxnId?: string }[];
  scheduleMismatchSeq?: number;
}

export function customerName(idx: number, rng: Rng) {
  return `${rng.pick(FIRST)} customer ${String(idx).padStart(3, "0")}`;
}

export function phoneFor(idx: number, variant = 0) {
  // Clearly synthetic +994 50 9xx xx xx numbers.
  const n = 9000000 + idx * 7 + variant * 100003;
  return `+99450${String(n).slice(0, 7)}`;
}

export async function createCustomer(prisma: PrismaClient, params: { id: string; cif?: string; name: string; branch: string; language?: "AZ" | "EN" | "RU"; phone: string; secondPhone?: string | null; phoneVerified?: boolean; status?: "ACTIVE" | "LEGAL" | "DECEASED_NOTIFIED"; specialHandling?: boolean; specialHandlingReason?: string }) {
  const customer = await prisma.customer.create({
    data: {
      id: params.id,
      cif: params.cif ?? params.id.replace("C-", "CIF-"),
      displayName: params.name,
      branch: params.branch,
      language: params.language ?? "AZ",
      status: params.status ?? "ACTIVE",
      sourceAsOf: new Date(SEED_NOW.getTime() - 5 * 60_000),
      specialHandling: params.specialHandling ?? false,
      specialHandlingReason: params.specialHandlingReason,
      contactPoints: {
        create: [
          { type: "MOBILE", value: params.phone, isPrimary: true, verification: params.phoneVerified === false ? "UNVERIFIED" : "VERIFIED", sourceAsOf: new Date(SEED_NOW.getTime() - 5 * 60_000) },
          ...(params.secondPhone ? [{ type: "MOBILE" as const, value: params.secondPhone, isPrimary: false, verification: "UNVERIFIED" as const, sourceAsOf: new Date(SEED_NOW.getTime() - 5 * 60_000) }] : []),
        ],
      },
    },
  });
  return customer;
}

/**
 * Creates a loan with its CORE_IMPORT schedule and posted payments so that the loan shows `targetDpd`
 * on the business date. Balances are later restated by recomputeLoanState (same service as runtime).
 */
export async function createLoan(prisma: PrismaClient, spec: LoanSpec) {
  const dpd = spec.targetDpd;
  let firstDue: IsoDate;
  let paymentDay: number;
  let paid = spec.paidInstallments;
  if (spec.firstDueDate) {
    firstDue = spec.firstDueDate;
    paymentDay = spec.paymentDay ?? Number(firstDue.slice(8, 10));
  } else if (dpd > 0) {
    const oldestUnpaid = addDays(BUSINESS_DATE, -dpd);
    paymentDay = Number(oldestUnpaid.slice(8, 10));
    firstDue = addMonthsClamped(oldestUnpaid, -paid, paymentDay);
  } else {
    // Current loan: last due installment paid; next due 1..27 days after the business date.
    const nextDue = addDays(BUSINESS_DATE, 1 + (paid % 27));
    paymentDay = Number(nextDue.slice(8, 10));
    firstDue = addMonthsClamped(nextDue, -paid, paymentDay);
  }
  const schedule = buildAnnuitySchedule({ principal: spec.principal, nominalAnnualRate: spec.rate, months: spec.tenor, firstDueDate: firstDue, paymentDay });
  const origination = addMonthsClamped(firstDue, -1, paymentDay);
  const maturity = schedule.installments[schedule.installments.length - 1].dueDate;

  const loan = await prisma.loan.create({
    data: {
      id: spec.id,
      coreLoanId: spec.coreLoanId ?? spec.id.replace("L-", "CORE-"),
      customerId: spec.customerId,
      branch: spec.branch,
      originationDate: toDbDate(origination),
      maturityDate: toDbDate(maturity),
      firstDueDate: toDbDate(firstDue),
      principalOriginal: toDbMoney(spec.principal),
      nominalAnnualRate: dec(spec.rate).toFixed(6),
      tenorMonths: spec.tenor,
      principalOutstanding: toDbMoney(spec.principal),
      balancesAsOf: SEED_NOW,
      status: "ACTIVE",
    },
  });
  const version = await prisma.scheduleVersion.create({
    data: { loanId: loan.id, versionNo: 1, source: "CORE_IMPORT", sourceRef: `CORE-SCHED-${loan.coreLoanId}-v1`, effectiveFrom: toDbDate(origination), isCurrent: true, checksum: `sha256:demo-${loan.id}`, basis: { note: "Imported core schedule (synthetic); regenerated by the annuity engine with the demo rounding policy" } as never },
  });
  await prisma.installment.createMany({
    data: schedule.installments.map((i) => {
      const mismatch = spec.scheduleMismatchSeq === i.seq;
      const interest = mismatch ? money(i.interestDue.plus("0.01")) : i.interestDue;
      return {
        scheduleVersionId: version.id,
        seq: i.seq,
        dueDate: toDbDate(i.dueDate),
        openingPrincipal: toDbMoney(i.openingPrincipal),
        principalDue: toDbMoney(i.principalDue),
        interestDue: toDbMoney(interest),
        feeDue: "0.00",
        totalDue: toDbMoney(i.principalDue.plus(interest)),
        closingPrincipal: toDbMoney(i.closingPrincipal),
      };
    }),
  });

  // Posted payments for the paid installments.
  const payments: { txnId: string; amount: string; valueDate: IsoDate; eventAt: Date; status: "POSTED" | "REVERSED" | "PENDING" | "QUARANTINED" | "UNMATCHED"; reversalOfTxnId?: string }[] = [];
  if (spec.paidOffEarly) {
    paid = schedule.installments.length;
    const payoffDate = addDays(BUSINESS_DATE, -20);
    for (const inst of schedule.installments) {
      const vd = inst.dueDate < payoffDate ? inst.dueDate : payoffDate;
      payments.push({ txnId: `CORE-TXN-${loan.coreLoanId}-${inst.seq}`, amount: inst.totalDue.toFixed(2), valueDate: vd, eventAt: bakuDateTime(vd, "11:00"), status: "POSTED" });
    }
  } else {
    for (let seq = 1; seq <= paid && seq <= schedule.installments.length; seq++) {
      const inst = schedule.installments[seq - 1];
      const lateDays = seq % 5 === 0 ? 2 : 0;
      const vd = addDays(inst.dueDate, lateDays);
      payments.push({ txnId: `CORE-TXN-${loan.coreLoanId}-${seq}`, amount: inst.totalDue.toFixed(2), valueDate: vd, eventAt: bakuDateTime(vd, "11:00"), status: "POSTED" });
    }
    if (spec.partialFraction && dpd > 0 && paid < schedule.installments.length) {
      const inst = schedule.installments[paid];
      const amount = money(inst.totalDue.times(spec.partialFraction));
      const vd = addDays(inst.dueDate, Math.min(dpd, 2));
      payments.push({ txnId: `CORE-TXN-${loan.coreLoanId}-P${inst.seq}`, amount: amount.toFixed(2), valueDate: vd, eventAt: bakuDateTime(vd, "15:30"), status: "POSTED" });
    }
  }
  for (const extra of spec.extraPayments ?? []) {
    payments.push({ txnId: extra.txnId, amount: extra.amount, valueDate: extra.valueDate, eventAt: extra.eventAt ?? bakuDateTime(extra.valueDate, "12:00"), status: extra.status ?? "POSTED", reversalOfTxnId: extra.reversalOfTxnId });
  }
  const created = new Map<string, string>();
  for (const p of payments) {
    const ev = await prisma.integrationEvent.create({
      data: {
        schemaVersion: "1.0",
        eventId: `demo-event-${p.txnId}`,
        eventType: p.reversalOfTxnId ? "payment.reversed" : "payment.posted",
        sourceSystem: "CORE_DEMO",
        sourceEventId: p.txnId,
        occurredAt: p.eventAt,
        receivedAt: new Date(p.eventAt.getTime() + 2000),
        processedAt: new Date(p.eventAt.getTime() + 2500),
        businessDate: toDbDate(p.valueDate),
        customerRef: spec.customerId,
        loanRef: loan.coreLoanId,
        payload: { amount: p.amount, currency: "AZN", valueDate: p.valueDate, status: p.status === "REVERSED" ? "REVERSED" : "POSTED", reversalOf: p.reversalOfTxnId ?? null } as never,
        status: p.status === "QUARANTINED" ? "QUARANTINED" : "PROCESSED",
      },
    });
    const row = await prisma.payment.create({
      data: {
        sourceSystem: "CORE_DEMO",
        sourceTransactionId: p.txnId,
        loanId: p.status === "QUARANTINED" ? null : loan.id,
        customerId: p.status === "QUARANTINED" ? null : spec.customerId,
        loanRef: loan.coreLoanId,
        customerRef: spec.customerId,
        amount: p.status === "REVERSED" && p.reversalOfTxnId ? dec(p.amount).negated().toFixed(2) : p.amount,
        eventAt: p.eventAt,
        valueDate: toDbDate(p.valueDate),
        postingDate: toDbDate(p.valueDate),
        status: p.reversalOfTxnId ? "REVERSED" : p.status,
        reconciliation: p.status === "QUARANTINED" ? "UNMATCHED" : p.reversalOfTxnId ? "REVERSAL_LINKED" : "MATCHED",
        reversalOfId: p.reversalOfTxnId ? created.get(p.reversalOfTxnId) ?? null : null,
        integrationEventId: ev.id,
        allocationPolicy: "DEMO_OLDEST_DUE_FIRST_INTEREST_THEN_PRINCIPAL",
      },
    });
    created.set(p.txnId, row.id);
    if (p.reversalOfTxnId) {
      const originalId = created.get(p.reversalOfTxnId);
      if (originalId) await prisma.payment.update({ where: { id: originalId }, data: { status: "REVERSED", reconciliation: "REVERSAL_LINKED", reconciliationNote: `Reversed by ${p.txnId}` } });
    }
  }
  return { loan, schedule, versionId: version.id };
}

export interface FeatureSpec {
  targetClass?: number; // 1..8 for 4-10 DPD
  maxDpdL3m?: number | null;
  month?: string; // observation month
  stale?: boolean;
}

export function featuresForClass(rng: Rng, targetClass: number): Record<string, number> {
  switch (targetClass) {
    case 1: return { DPD_MAX_MAX12: rng.int(1, 7), DPD_RATIO_ADJ_MAX12: rng.float(0.026, 0.2), DPD_RATIO_ADJ_V3LM: rng.float(-0.3, 0.3), DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: rng.float(0, 0.15) };
    case 2: return { DPD_MAX_MAX12: rng.int(8, 30), DPD_RATIO_ADJ_MAX12: rng.float(0.031, 0.3), DPD_RATIO_ADJ_V3LM: rng.float(-0.3, 0.3), DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: rng.float(0, 0.2) };
    case 3: return { DPD_MAX_MAX12: rng.int(0, 30), DPD_RATIO_ADJ_MAX12: rng.float(0, 0.025), DPD_RATIO_ADJ_V3LM: rng.float(-0.2, 0.2), DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: rng.float(0, 0.02) };
    case 4: return { DPD_MAX_MAX12: rng.int(8, 30), DPD_RATIO_ADJ_MAX12: rng.float(0.0251, 0.03), DPD_RATIO_ADJ_V3LM: rng.float(-0.3, 0.3), DPD30_ADJ100_CNT_L6M: 0, DPD_RATIO_ADJ_VLM: rng.float(0, 0.03) };
    case 5: return { DPD_MAX_MAX12: rng.int(31, 70), DPD_RATIO_ADJ_MAX12: rng.float(0.05, 0.4), DPD_RATIO_ADJ_V3LM: rng.float(-0.39, 0.3), DPD30_ADJ100_CNT_L6M: rng.int(0, 1), DPD_RATIO_ADJ_VLM: rng.float(0, 0.2) };
    case 6: return { DPD_MAX_MAX12: rng.int(31, 70), DPD_RATIO_ADJ_MAX12: rng.float(0.2, 0.6), DPD_RATIO_ADJ_V3LM: rng.float(-0.39, 0.3), DPD30_ADJ100_CNT_L6M: rng.int(0, 1), DPD_RATIO_ADJ_VLM: rng.float(0.201, 0.6) };
    case 7: return { DPD_MAX_MAX12: rng.int(31, 90), DPD_RATIO_ADJ_MAX12: rng.float(0.2, 0.7), DPD_RATIO_ADJ_V3LM: rng.float(-0.39, 0.3), DPD30_ADJ100_CNT_L6M: rng.int(2, 4), DPD_RATIO_ADJ_VLM: rng.float(0, 0.6) };
    default: return { DPD_MAX_MAX12: rng.int(31, 90), DPD_RATIO_ADJ_MAX12: rng.float(0.2, 0.7), DPD_RATIO_ADJ_V3LM: rng.float(-0.9, -0.4), DPD30_ADJ100_CNT_L6M: rng.int(0, 3), DPD_RATIO_ADJ_VLM: rng.float(0, 0.3) };
  }
}

export async function createFeatureSnapshot(prisma: PrismaClient, customerId: string, features: Record<string, number | null>, opts: { month?: string; stale?: boolean } = {}) {
  const month = opts.month ?? (opts.stale ? "2026-07" : "2026-09");
  const asOf = opts.stale ? "2026-07-31" : month === "2026-09" ? "2026-09-30" : `${month}-28`;
  return prisma.featureSnapshot.create({
    data: { customerId, asOf: toDbDate(asOf), observationMonth: month, features: features as never, isLatestComplete: true, qualityFlags: opts.stale ? ["STALE_SNAPSHOT"] : [], source: "PROMETEIA_FEATURE_FILE_DEMO" },
  });
}

/** Generic portfolio generator: returns created customer ids. */
export async function seedPortfolio(prisma: PrismaClient, rng: Rng) {
  const groups: { count: number; dpd: () => number; cls?: (i: number) => number; unscored?: (i: number) => "MISSING" | "STALE" | null }[] = [
    { count: 25, dpd: () => 0 },
    { count: 55, dpd: () => rng.int(1, 3), unscored: (i) => (i % 11 === 0 ? "MISSING" : null) },
    { count: 90, dpd: () => rng.int(4, 10), cls: (i) => (i % 8) + 1, unscored: (i) => (i % 30 === 7 ? "MISSING" : i % 45 === 13 ? "STALE" : null) },
    { count: 30, dpd: () => rng.int(11, 16) },
    { count: 22, dpd: () => rng.int(17, 23) },
    { count: 18, dpd: () => rng.int(24, 30) },
    { count: 14, dpd: () => rng.int(31, 45) },
    { count: 6, dpd: () => rng.int(46, 60) },
    { count: 4, dpd: () => rng.int(61, 90) },
    { count: 2, dpd: () => rng.int(91, 140) },
  ];
  let idx = 100;
  const customerIds: string[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.count; i++) {
      idx++;
      const id = `C-SYN-${String(idx).padStart(4, "0")}`;
      const branch = rng.pick(BRANCHES);
      const language = rng.chance(0.75) ? "AZ" : rng.chance(0.6) ? "RU" : "EN";
      await createCustomer(prisma, { id, name: customerName(idx, rng), branch, language, phone: phoneFor(idx), secondPhone: rng.chance(0.3) ? phoneFor(idx, 1) : null, phoneVerified: rng.chance(0.85) });
      const dpd = g.dpd();
      const tenor = rng.pick([12, 18, 24, 36, 48]);
      const paid = rng.int(0, Math.max(0, tenor - 3));
      await createLoan(prisma, { id: `L-SYN-${String(idx).padStart(4, "0")}A`, customerId: id, branch, principal: rng.money(600, 8000, 50), rate: (rng.int(28, 48) / 200).toFixed(3), tenor, targetDpd: dpd, paidInstallments: paid, partialFraction: dpd > 0 && rng.chance(0.12) ? rng.float(0.3, 0.6, 2) : undefined });
      if (rng.chance(0.28)) {
        const second = rng.chance(0.7) ? 0 : Math.max(0, Math.min(dpd, rng.int(1, dpd)));
        const tenor2 = rng.pick([12, 24, 36]);
        await createLoan(prisma, { id: `L-SYN-${String(idx).padStart(4, "0")}B`, customerId: id, branch, principal: rng.money(400, 2000, 50), rate: (rng.int(30, 46) / 200).toFixed(3), tenor: tenor2, targetDpd: second, paidInstallments: rng.int(0, Math.max(0, tenor2 - 3)) });
      }
      const un = g.unscored?.(i) ?? null;
      if (un !== "MISSING") {
        const cls = g.cls ? g.cls(i) : rng.int(1, 8);
        const f = featuresForClass(rng, cls);
        const features: Record<string, number | null> = { ...f, MAX_DPD_L3M: un === null && g.unscored && dpd <= 3 ? rng.int(0, 12) : rng.int(0, 40) };
        if (dpd <= 3 && g.unscored && g.unscored(i) === "MISSING") features.MAX_DPD_L3M = null;
        await createFeatureSnapshot(prisma, id, features, { stale: un === "STALE" });
      }
      customerIds.push(id);
    }
  }
  return customerIds;
}
