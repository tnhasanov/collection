import type { PrismaClient } from "@/generated/prisma/client";
import type { Rng } from "./rng";
import { createCustomer, createFeatureSnapshot, createLoan, featuresForClass, phoneFor, BUSINESS_DATE, SEED_NOW } from "./portfolio";
import { addDays, bakuDateTime, bakuEndOfDay, toDbDate } from "@/server/dates";
import { toDbMoney, dec } from "@/server/money";
import { randomUUID } from "node:crypto";

type TechnicalResult = "ANSWERED" | "NO_ANSWER" | "BUSY" | "UNREACHABLE" | "FAILED" | "MACHINE";
type Identity = "RPC_VERIFIED" | "THIRD_PARTY" | "WRONG_NUMBER" | "NOT_ESTABLISHED" | "VERIFICATION_FAILED";
type Outcome = "PTP" | "PARTIAL_COMMITMENT" | "NO_COMMITMENT" | "CALLBACK_REQUESTED" | "ALREADY_PAID_CLAIM" | "DISPUTE" | "SUPPORT_NEEDED" | "REFUSED" | "SPECIAL_REFERRAL" | "NO_CONVERSATION";

/** Seeds a completed historical call (reservation → attempt → interaction) with consistent timestamps. */
export async function seedHistoricalCall(prisma: PrismaClient, p: { customerId: string; agentUserId: string; at: Date; technical: TechnicalResult; identity?: Identity; outcome?: Outcome; reason?: "SALARY_TIMING" | "TEMPORARY_SHORTFALL" | "INCOME_INTERRUPTION" | "AFFORDABILITY" | "FORGOT" | "TECHNICAL_PAYMENT_ISSUE" | "DISPUTED_DEBT" | "OTHER" | "NOT_STATED"; talkSeconds?: number; note?: string; promise?: { amount: string; deadline: string; loanId: string } }) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { id: p.customerId }, include: { contactPoints: true, cases: { where: { status: { in: ["OPEN", "HANDOVER"] } } } } });
  const cp = customer.contactPoints.find((c) => c.isPrimary) ?? customer.contactPoints[0];
  const correlationId = `hist-${randomUUID()}`;
  const answered = p.technical === "ANSWERED";
  const talk = answered ? p.talkSeconds ?? 180 : 0;
  const ringing = new Date(p.at.getTime() + 2000);
  const answeredAt = answered ? new Date(p.at.getTime() + 9000) : null;
  const endedAt = new Date(p.at.getTime() + (answered ? 9000 + talk * 1000 : 25000));
  const caseId = customer.cases[0]?.id ?? null;
  const wi = caseId
    ? await prisma.workItem.create({ data: { customerId: p.customerId, caseId, type: "CALL", status: "COMPLETED", completedAt: endedAt, priority: "0.00", reason: "HISTORICAL_SEED", campaignCode: "SOFT_COLLECTIONS_VOICE" } })
    : null;
  if (!wi || !caseId) return null;
  const reservation = await prisma.routingReservation.create({
    data: { correlationId, workItemId: wi.id, customerId: p.customerId, caseId, agentUserId: p.agentUserId, campaignCode: "SOFT_COLLECTIONS_VOICE", contactPointId: cp.id, status: "RELEASED", expiresAt: new Date(p.at.getTime() + 600000), createdAt: new Date(p.at.getTime() - 3000), releasedAt: endedAt, releaseReason: "WRAP_UP_ACKNOWLEDGED", authorizationRef: `auth-${correlationId}` },
  });
  const attempt = await prisma.dialAttempt.create({
    data: { reservationId: reservation.id, contactPointId: cp.id, providerAttemptRef: `mock-att-${correlationId}`, startedAt: p.at, ringingAt: ringing, answeredAt, bridgedAt: answeredAt, endedAt, technicalResult: p.technical },
  });
  const isRpc = p.identity === "RPC_VERIFIED";
  const interaction = await prisma.interaction.create({
    data: {
      correlationId,
      idempotencyKey: `hist:${correlationId}`,
      customerId: p.customerId,
      caseId,
      workItemId: wi.id,
      reservationId: reservation.id,
      dialAttemptId: attempt.id,
      agentUserId: p.agentUserId,
      channel: "VOICE_OUTBOUND",
      contactPointId: cp.id,
      providerInteractionRef: `mock-call-${correlationId}`,
      campaignCode: "SOFT_COLLECTIONS_VOICE",
      startedAt: p.at,
      connectedAt: answeredAt,
      endedAt,
      acwStartedAt: endedAt,
      acwEndedAt: new Date(endedAt.getTime() + 45000),
      talkSeconds: talk,
      ringSeconds: answered ? 7 : 23,
      acwSeconds: answered ? 45 : 0,
      technicalResult: p.technical,
      identityStatus: answered ? p.identity ?? "NOT_ESTABLISHED" : null,
      businessOutcome: answered ? p.outcome ?? "NO_CONVERSATION" : "NO_CONVERSATION",
      nonPaymentReason: isRpc ? p.reason ?? "NOT_STATED" : null,
      nextAction: isRpc ? (p.promise ? "MONITOR_PTP" : p.outcome === "ALREADY_PAID_CLAIM" ? "RECONCILE_CLAIM" : p.outcome === "DISPUTE" ? "DISPUTE_REVIEW" : p.outcome === "SUPPORT_NEEDED" ? "SUPPORT_REFERRAL" : "COOLDOWN") : p.identity === "WRONG_NUMBER" ? "CONTACT_CORRECTION" : "POLICY_RETRY",
      note: p.note,
      status: "SAVED",
      savedAt: new Date(endedAt.getTime() + 45000),
      wrapUpStatus: "ACKNOWLEDGED",
      wrapUpAckAt: new Date(endedAt.getTime() + 46000),
      providerDispositionCode: isRpc ? "RPC" : answered ? "ANSWERED_NO_RPC" : p.technical,
      scriptVersionId: `TPL-SOFT-01-${customer.language}`,
      dispositionVersion: "DISP-DEMO-01",
      policyVersionId: "CP-DEMO-01",
      isRpc,
    },
  });
  if (p.promise) {
    const deadline = bakuEndOfDay(p.promise.deadline);
    await prisma.promise.create({
      data: {
        customerId: p.customerId,
        caseId,
        interactionId: interaction.id,
        createdByUserId: p.agentUserId,
        ownerUserId: p.agentUserId,
        amount: p.promise.amount,
        deadline,
        deadlineDate: toDbDate(p.promise.deadline),
        coveredLoanIds: [p.promise.loanId],
        scopeDescription: `${p.promise.loanId} / oldest overdue installment`,
        customerConfirmed: true,
        status: "ACTIVE",
        remainingAmount: p.promise.amount,
        qualifyingWindowStart: p.at,
        qualifyingWindowEnd: new Date(deadline.getTime() + 2 * 86400000),
        settlementAllowanceDays: 2,
        suppressionUntil: new Date(Math.max(deadline.getTime() + 2 * 86400000, p.at.getTime() + 120 * 3600000)),
        reminderPlan: { smsBeforeDeadlineDays: 1, template: "PTP-REMINDER-01" } as never,
        policyVersionId: "CP-DEMO-01",
        events: { create: { type: "CREATED", toStatus: "ACTIVE", actorUserId: p.agentUserId, data: { amount: p.promise.amount, deadline: p.promise.deadline } as never } },
      },
    });
  }
  return interaction;
}

export async function seedScenarios(prisma: PrismaClient, rng: Rng) {
  const t = (iso: string, hm: string) => bakuDateTime(iso, hm);
  const yesterday = addDays(BUSINESS_DATE, -1);

  // 001 - hero: 10,000 / 18% / 24, first installment 20 Oct unpaid → DPD 7, class 8, ERA 4,200 (bucket 10 expected).
  await createCustomer(prisma, { id: "C-DEMO-001", name: "Demo customer 001", branch: "Baku-Nasimi", language: "AZ", phone: "+994501000001" });
  await createLoan(prisma, { id: "L-DEMO-001", coreLoanId: "CORE-L-DEMO-001", customerId: "C-DEMO-001", branch: "Baku-Nasimi", principal: "10000.00", rate: "0.18", tenor: 24, targetDpd: 7, paidInstallments: 0, firstDueDate: "2026-10-20" });
  await createFeatureSnapshot(prisma, "C-DEMO-001", { DPD_MAX_MAX12: 45, DPD_RATIO_ADJ_MAX12: 0.3, DPD_RATIO_ADJ_V3LM: -0.5, DPD30_ADJ100_CNT_L6M: 2, DPD_RATIO_ADJ_VLM: 0.1, MAX_DPD_L3M: 12 });

  // 002 - later band 24 DPD, exposure ≈ 1,000 → ERA 337.
  await createCustomer(prisma, { id: "C-DEMO-002", name: "Demo customer 002", branch: "Baku-Yasamal", language: "RU", phone: "+994501000002" });
  await createLoan(prisma, { id: "L-DEMO-002", customerId: "C-DEMO-002", branch: "Baku-Yasamal", principal: "1000.00", rate: "0.20", tenor: 12, targetDpd: 24, paidInstallments: 0 });
  await createFeatureSnapshot(prisma, "C-DEMO-002", { ...featuresForClass(rng, 3), MAX_DPD_L3M: 24 });

  // 003 - 12 DPD, exposure 2,500 → ERA 495.
  await createCustomer(prisma, { id: "C-DEMO-003", name: "Demo customer 003", branch: "Sumgayit", language: "AZ", phone: "+994501000003" });
  await createLoan(prisma, { id: "L-DEMO-003", customerId: "C-DEMO-003", branch: "Sumgayit", principal: "2500.00", rate: "0.19", tenor: 18, targetDpd: 12, paidInstallments: 0 });
  await createFeatureSnapshot(prisma, "C-DEMO-003", { ...featuresForClass(rng, 2), MAX_DPD_L3M: 12 });

  // 004 - DPD 2, 1-3 rule input missing → Unscored / manual review.
  await createCustomer(prisma, { id: "C-DEMO-004", name: "Demo customer 004", branch: "Ganja", language: "AZ", phone: "+994501000004" });
  await createLoan(prisma, { id: "L-DEMO-004", customerId: "C-DEMO-004", branch: "Ganja", principal: "4000.00", rate: "0.16", tenor: 24, targetDpd: 2, paidInstallments: 5 });
  await createFeatureSnapshot(prisma, "C-DEMO-004", { ...featuresForClass(rng, 1), MAX_DPD_L3M: null });

  // 005 - DPD 6, class 7, verified RPC yesterday 14:00 → cooldown until 31 Oct 14:00.
  await createCustomer(prisma, { id: "C-DEMO-005", name: "Demo customer 005", branch: "Baku-Khatai", language: "AZ", phone: "+994501000005" });
  await createLoan(prisma, { id: "L-DEMO-005", customerId: "C-DEMO-005", branch: "Baku-Khatai", principal: "8000.00", rate: "0.18", tenor: 36, targetDpd: 6, paidInstallments: 4 });
  await createFeatureSnapshot(prisma, "C-DEMO-005", { DPD_MAX_MAX12: 40, DPD_RATIO_ADJ_MAX12: 0.25, DPD_RATIO_ADJ_V3LM: 0.1, DPD30_ADJ100_CNT_L6M: 2, DPD_RATIO_ADJ_VLM: 0.2, MAX_DPD_L3M: 9 });

  // 006 - 36 DPD later-stage queue (no early score).
  await createCustomer(prisma, { id: "C-DEMO-006", name: "Demo customer 006", branch: "Baku-Sabail", language: "AZ", phone: "+994501000006" });
  await createLoan(prisma, { id: "L-DEMO-006", customerId: "C-DEMO-006", branch: "Baku-Sabail", principal: "3200.00", rate: "0.21", tenor: 24, targetDpd: 36, paidInstallments: 3 });
  await createFeatureSnapshot(prisma, "C-DEMO-006", { ...featuresForClass(rng, 6), MAX_DPD_L3M: 36 });

  // 007 - two loans: one DPD 9, one current → one case, one exposure aggregation.
  await createCustomer(prisma, { id: "C-DEMO-007", name: "Demo customer 007", branch: "Baku-Nasimi", language: "RU", phone: "+994501000007" });
  await createLoan(prisma, { id: "L-DEMO-007A", customerId: "C-DEMO-007", branch: "Baku-Nasimi", principal: "6000.00", rate: "0.17", tenor: 24, targetDpd: 9, paidInstallments: 6 });
  await createLoan(prisma, { id: "L-DEMO-007B", customerId: "C-DEMO-007", branch: "Baku-Nasimi", principal: "3000.00", rate: "0.19", tenor: 12, targetDpd: 0, paidInstallments: 2 });
  await createFeatureSnapshot(prisma, "C-DEMO-007", { ...featuresForClass(rng, 5), MAX_DPD_L3M: 9 });

  // 008 - wrong number on primary mobile; alternative unverified number.
  await createCustomer(prisma, { id: "C-DEMO-008", name: "Demo customer 008", branch: "Sumgayit", language: "AZ", phone: "+994501000008", secondPhone: "+994551000008" });
  await createLoan(prisma, { id: "L-DEMO-008", customerId: "C-DEMO-008", branch: "Sumgayit", principal: "7500.00", rate: "0.18", tenor: 24, targetDpd: 8, paidInstallments: 7 });
  await createFeatureSnapshot(prisma, "C-DEMO-008", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 8 });

  // 009 - third-party answer yesterday (not RPC), still eligible.
  await createCustomer(prisma, { id: "C-DEMO-009", name: "Demo customer 009", branch: "Ganja", language: "AZ", phone: "+994501000009" });
  await createLoan(prisma, { id: "L-DEMO-009", customerId: "C-DEMO-009", branch: "Ganja", principal: "7000.00", rate: "0.18", tenor: 36, targetDpd: 5, paidInstallments: 10 });
  await createFeatureSnapshot(prisma, "C-DEMO-009", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 5 });

  // 010 - failed attempt today 09:30 (no answer), high ERA → same-day retry after 12:30.
  await createCustomer(prisma, { id: "C-DEMO-010", name: "Demo customer 010", branch: "Baku-Yasamal", language: "AZ", phone: "+994501000010" });
  await createLoan(prisma, { id: "L-DEMO-010", customerId: "C-DEMO-010", branch: "Baku-Yasamal", principal: "9000.00", rate: "0.18", tenor: 36, targetDpd: 8, paidInstallments: 2 });
  await createFeatureSnapshot(prisma, "C-DEMO-010", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 8 });

  // 011 - PTP kept (275 paid today).
  await createCustomer(prisma, { id: "C-DEMO-011", name: "Demo customer 011", branch: "Baku-Khatai", language: "AZ", phone: "+994501000011" });
  await createLoan(prisma, { id: "L-DEMO-011", customerId: "C-DEMO-011", branch: "Baku-Khatai", principal: "3000.00", rate: "0.18", tenor: 12, targetDpd: 10, paidInstallments: 3, extraPayments: [{ amount: "275.04", valueDate: BUSINESS_DATE, eventAt: t(BUSINESS_DATE, "09:20"), txnId: "DEMO-TXN-011-PTP" }] });
  await createFeatureSnapshot(prisma, "C-DEMO-011", { ...featuresForClass(rng, 2), MAX_DPD_L3M: 10 });

  // 012 - partially paid PTP (420 promised, 150 paid).
  await createCustomer(prisma, { id: "C-DEMO-012", name: "Demo customer 012", branch: "Baku-Sabail", language: "RU", phone: "+994501000012" });
  await createLoan(prisma, { id: "L-DEMO-012", customerId: "C-DEMO-012", branch: "Baku-Sabail", principal: "4500.00", rate: "0.2", tenor: 12, targetDpd: 15, paidInstallments: 4, extraPayments: [{ amount: "150.00", valueDate: BUSINESS_DATE, eventAt: t(BUSINESS_DATE, "09:40"), txnId: "DEMO-TXN-012-PART" }] });
  await createFeatureSnapshot(prisma, "C-DEMO-012", { ...featuresForClass(rng, 3), MAX_DPD_L3M: 15 });

  // 013 - promise deadline passed yesterday, payment feed uncertain → pending reconciliation.
  await createCustomer(prisma, { id: "C-DEMO-013", name: "Demo customer 013", branch: "Baku-Nasimi", language: "AZ", phone: "+994501000013" });
  await createLoan(prisma, { id: "L-DEMO-013", customerId: "C-DEMO-013", branch: "Baku-Nasimi", principal: "2400.00", rate: "0.18", tenor: 12, targetDpd: 9, paidInstallments: 5 });
  await createFeatureSnapshot(prisma, "C-DEMO-013", { ...featuresForClass(rng, 1), MAX_DPD_L3M: 9 });

  // 014 - broken promise (deadline 25 Oct, nothing paid).
  await createCustomer(prisma, { id: "C-DEMO-014", name: "Demo customer 014", branch: "Baku-Yasamal", language: "AZ", phone: "+994501000014" });
  await createLoan(prisma, { id: "L-DEMO-014", customerId: "C-DEMO-014", branch: "Baku-Yasamal", principal: "5200.00", rate: "0.17", tenor: 24, targetDpd: 19, paidInstallments: 8 });
  await createFeatureSnapshot(prisma, "C-DEMO-014", { ...featuresForClass(rng, 6), MAX_DPD_L3M: 19 });

  // 015 - already-paid claim yesterday → reconciliation task + 48h hold.
  await createCustomer(prisma, { id: "C-DEMO-015", name: "Demo customer 015", branch: "Ganja", language: "AZ", phone: "+994501000015" });
  await createLoan(prisma, { id: "L-DEMO-015", customerId: "C-DEMO-015", branch: "Ganja", principal: "8100.00", rate: "0.18", tenor: 24, targetDpd: 7, paidInstallments: 9 });
  await createFeatureSnapshot(prisma, "C-DEMO-015", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 7 });

  // 016 - open dispute.
  await createCustomer(prisma, { id: "C-DEMO-016", name: "Demo customer 016", branch: "Baku-Khatai", language: "EN", phone: "+994501000016" });
  await createLoan(prisma, { id: "L-DEMO-016", customerId: "C-DEMO-016", branch: "Baku-Khatai", principal: "9800.00", rate: "0.19", tenor: 36, targetDpd: 13, paidInstallments: 11 });
  await createFeatureSnapshot(prisma, "C-DEMO-016", { ...featuresForClass(rng, 5), MAX_DPD_L3M: 13 });

  // 017 - hardship support case + arrangement draft.
  await createCustomer(prisma, { id: "C-DEMO-017", name: "Demo customer 017", branch: "Sumgayit", language: "AZ", phone: "+994501000017" });
  await createLoan(prisma, { id: "L-DEMO-017", customerId: "C-DEMO-017", branch: "Sumgayit", principal: "12000.00", rate: "0.18", tenor: 48, targetDpd: 22, paidInstallments: 14 });
  await createFeatureSnapshot(prisma, "C-DEMO-017", { ...featuresForClass(rng, 7), MAX_DPD_L3M: 22 });

  // 018 - stale balances (set after recompute).
  await createCustomer(prisma, { id: "C-DEMO-018", name: "Demo customer 018", branch: "Baku-Sabail", language: "AZ", phone: "+994501000018" });
  await createLoan(prisma, { id: "L-DEMO-018", customerId: "C-DEMO-018", branch: "Baku-Sabail", principal: "7900.00", rate: "0.18", tenor: 24, targetDpd: 6, paidInstallments: 6 });
  await createFeatureSnapshot(prisma, "C-DEMO-018", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 6 });

  // 019 - missing model features (DPD 8) → unscored.
  await createCustomer(prisma, { id: "C-DEMO-019", name: "Demo customer 019", branch: "Baku-Nasimi", language: "AZ", phone: "+994501000019" });
  await createLoan(prisma, { id: "L-DEMO-019", customerId: "C-DEMO-019", branch: "Baku-Nasimi", principal: "4300.00", rate: "0.18", tenor: 24, targetDpd: 8, paidInstallments: 3 });

  // 020 - payment posted 25 Oct then reversed 26 Oct → arrears reopened with history.
  await createCustomer(prisma, { id: "C-DEMO-020", name: "Demo customer 020", branch: "Ganja", language: "RU", phone: "+994501000020" });
  await createLoan(prisma, { id: "L-DEMO-020", coreLoanId: "CORE-L-DEMO-020", customerId: "C-DEMO-020", branch: "Ganja", principal: "2800.00", rate: "0.2", tenor: 12, targetDpd: 11, paidInstallments: 4, extraPayments: [
    { amount: "120.00", valueDate: addDays(BUSINESS_DATE, -2), txnId: "DEMO-TXN-020-PAY" },
    { amount: "120.00", valueDate: addDays(BUSINESS_DATE, -1), txnId: "DEMO-TXN-020-REV", reversalOfTxnId: "DEMO-TXN-020-PAY" },
  ] });
  await createFeatureSnapshot(prisma, "C-DEMO-020", { ...featuresForClass(rng, 3), MAX_DPD_L3M: 11 });

  // 021 - early full repayment of one loan; second loan current.
  await createCustomer(prisma, { id: "C-DEMO-021", name: "Demo customer 021", branch: "Baku-Yasamal", language: "AZ", phone: "+994501000021" });
  await createLoan(prisma, { id: "L-DEMO-021A", customerId: "C-DEMO-021", branch: "Baku-Yasamal", principal: "1500.00", rate: "0.18", tenor: 12, targetDpd: 0, paidInstallments: 6, paidOffEarly: true });
  await createLoan(prisma, { id: "L-DEMO-021B", customerId: "C-DEMO-021", branch: "Baku-Yasamal", principal: "6000.00", rate: "0.17", tenor: 36, targetDpd: 0, paidInstallments: 8 });

  // 022 - schedule mismatch (core interest differs by 0.01 on installment 3).
  await createCustomer(prisma, { id: "C-DEMO-022", name: "Demo customer 022", branch: "Baku-Khatai", language: "AZ", phone: "+994501000022" });
  await createLoan(prisma, { id: "L-DEMO-022", customerId: "C-DEMO-022", branch: "Baku-Khatai", principal: "3600.00", rate: "0.18", tenor: 18, targetDpd: 4, paidInstallments: 5, scheduleMismatchSeq: 10 });
  await createFeatureSnapshot(prisma, "C-DEMO-022", { ...featuresForClass(rng, 1), MAX_DPD_L3M: 4 });

  // 023 - duplicate CIF in customer master (exception only).
  await createCustomer(prisma, { id: "C-DEMO-023", name: "Demo customer 023", branch: "Sumgayit", language: "AZ", phone: "+994501000023" });
  await createLoan(prisma, { id: "L-DEMO-023", customerId: "C-DEMO-023", branch: "Sumgayit", principal: "2000.00", rate: "0.2", tenor: 12, targetDpd: 3, paidInstallments: 4 });
  await createFeatureSnapshot(prisma, "C-DEMO-023", { ...featuresForClass(rng, 3), MAX_DPD_L3M: 3 });

  // 025 - callback due today 10:30 owned by Senior Agent A, requested by the customer in yesterday's RPC.
  await createCustomer(prisma, { id: "C-DEMO-025", name: "Demo customer 025", branch: "Baku-Nasimi", language: "AZ", phone: "+994501000025" });
  await createLoan(prisma, { id: "L-DEMO-025", customerId: "C-DEMO-025", branch: "Baku-Nasimi", principal: "8800.00", rate: "0.18", tenor: 36, targetDpd: 10, paidInstallments: 12 });
  await createFeatureSnapshot(prisma, "C-DEMO-025", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 10 });

  // 026 - low-ERA SMS-only customer.
  await createCustomer(prisma, { id: "C-DEMO-026", name: "Demo customer 026", branch: "Ganja", language: "AZ", phone: "+994501000026" });
  await createLoan(prisma, { id: "L-DEMO-026", customerId: "C-DEMO-026", branch: "Ganja", principal: "300.00", rate: "0.2", tenor: 12, targetDpd: 5, paidInstallments: 9 });
  await createFeatureSnapshot(prisma, "C-DEMO-026", { ...featuresForClass(rng, 3), MAX_DPD_L3M: 5 });

  // 027 / 028 - unrelated customers sharing a phone number (screen pop must use trusted ids).
  await createCustomer(prisma, { id: "C-DEMO-027", name: "Demo customer 027", branch: "Baku-Sabail", language: "AZ", phone: "+994501000027" });
  await createLoan(prisma, { id: "L-DEMO-027", customerId: "C-DEMO-027", branch: "Baku-Sabail", principal: "7000.00", rate: "0.18", tenor: 24, targetDpd: 7, paidInstallments: 5 });
  await createFeatureSnapshot(prisma, "C-DEMO-027", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 7 });
  await createCustomer(prisma, { id: "C-DEMO-028", name: "Demo customer 028", branch: "Baku-Sabail", language: "RU", phone: "+994501000027" });
  await createLoan(prisma, { id: "L-DEMO-028", customerId: "C-DEMO-028", branch: "Baku-Sabail", principal: "6900.00", rate: "0.19", tenor: 24, targetDpd: 9, paidInstallments: 8 });
  await createFeatureSnapshot(prisma, "C-DEMO-028", { ...featuresForClass(rng, 8), MAX_DPD_L3M: 9 });

  // 029 - deceased/legal notification → special-case referral, no routine calls.
  await createCustomer(prisma, { id: "C-DEMO-029", name: "Demo customer 029", branch: "Baku-Khatai", language: "AZ", phone: "+994501000029", status: "DECEASED_NOTIFIED", specialHandling: true, specialHandlingReason: "Deceased notification received 24 Oct (synthetic)" });
  await createLoan(prisma, { id: "L-DEMO-029", customerId: "C-DEMO-029", branch: "Baku-Khatai", principal: "9500.00", rate: "0.18", tenor: 48, targetDpd: 17, paidInstallments: 20 });
  await createFeatureSnapshot(prisma, "C-DEMO-029", { ...featuresForClass(rng, 5), MAX_DPD_L3M: 17 });

  // 030 - current customer with a kept history (cured episode).
  await createCustomer(prisma, { id: "C-DEMO-030", name: "Demo customer 030", branch: "Baku-Nasimi", language: "AZ", phone: "+994501000030" });
  await createLoan(prisma, { id: "L-DEMO-030", customerId: "C-DEMO-030", branch: "Baku-Nasimi", principal: "4000.00", rate: "0.18", tenor: 24, targetDpd: 0, paidInstallments: 10 });

  // Quarantined payment with a missing loan reference (unmatched feed row) + import batch with issues.
  const qEvent = await prisma.integrationEvent.create({
    data: { schemaVersion: "1.0", eventId: "demo-event-DEMO-TXN-003", eventType: "payment.posted", sourceSystem: "CORE_DEMO", sourceEventId: "DEMO-TXN-003", occurredAt: t(BUSINESS_DATE, "09:12"), businessDate: toDbDate(BUSINESS_DATE), loanRef: "CORE-L-UNKNOWN-777", payload: { amount: "250.00", currency: "AZN", valueDate: BUSINESS_DATE, status: "POSTED" } as never, status: "QUARANTINED", errorMessage: "Loan reference CORE-L-UNKNOWN-777 not found in the loan projection" },
  });
  const qPayment = await prisma.payment.create({
    data: { sourceSystem: "CORE_DEMO", sourceTransactionId: "DEMO-TXN-003", loanRef: "CORE-L-UNKNOWN-777", amount: "250.00", eventAt: t(BUSINESS_DATE, "09:12"), valueDate: toDbDate(BUSINESS_DATE), status: "QUARANTINED", reconciliation: "UNMATCHED", reconciliationNote: "Reference missing; held for review", integrationEventId: qEvent.id },
  });
  await prisma.exceptionCase.create({
    data: { dedupKey: `UNMATCHED_PAYMENT:${qPayment.id}`, type: "UNMATCHED_PAYMENT", severity: "WARNING", paymentId: qPayment.id, title: "Posted payment 250.00 AZN has no matching loan reference", evidence: { sourceTransactionId: "DEMO-TXN-003", loanRef: "CORE-L-UNKNOWN-777" } as never, affectedOutreach: { note: "No customer resolved; no outreach affected" } as never, slaDueAt: addDaysDate(SEED_NOW, 1) },
  });
  const batch = await prisma.importBatch.create({
    data: { id: "IMP-PAY-20261027", dataset: "payments", fileName: "payments_2026-10-27_0900.csv", checksum: "sha256:demo-payments-20261027", status: "COMMITTED", rowCount: 48, acceptedCount: 45, quarantinedCount: 2, duplicateCount: 1, controlTotals: { rows: 48, amountAzn: "18420.00", currency: "AZN" } as never, columnMapping: { txn_id: "sourceTransactionId", loan_no: "loanRef", amt: "amount", ccy: "currency", value_dt: "valueDate" } as never, sourceAsOf: t(BUSINESS_DATE, "09:00"), createdBy: "U-INTEGRATION", committedAt: t(BUSINESS_DATE, "09:05"), summary: { note: "Synthetic morning payment file; 2 rows quarantined (missing loan reference, invalid date), 1 duplicate ignored" } as never },
  });
  await prisma.dataIssue.createMany({
    data: [
      { importBatchId: batch.id, severity: "CRITICAL", code: "MISSING_LOAN_REFERENCE", rowNumber: 17, message: "loan_no CORE-L-UNKNOWN-777 not found", rowJson: { txn_id: "DEMO-TXN-003", loan_no: "CORE-L-UNKNOWN-777", amt: "250.00" } as never },
      { importBatchId: batch.id, severity: "CRITICAL", code: "INVALID_DATE", rowNumber: 31, message: "value_dt '2026-13-02' is not a valid date", rowJson: { txn_id: "DEMO-TXN-031", loan_no: "CORE-L-SYN-0120A", amt: "90.00", value_dt: "2026-13-02" } as never },
      { importBatchId: batch.id, severity: "WARNING", code: "DUPLICATE_SOURCE_ID", rowNumber: 44, message: "txn_id DEMO-TXN-011-PTP already processed; row ignored", rowJson: { txn_id: "DEMO-TXN-011-PTP" } as never },
    ],
  });

  // Exceptions for scenario customers.
  await prisma.exceptionCase.create({ data: { dedupKey: "SCHEDULE_MISMATCH:L-DEMO-022", type: "SCHEDULE_MISMATCH", severity: "WARNING", customerId: "C-DEMO-022", loanId: "L-DEMO-022", title: "Core schedule differs from local annuity simulation (installment 10 interest +0.01)", evidence: { installment: 10, coreInterest: "variance +0.01", note: "Core schedule retained; simulation is comparison only" } as never } });
  await prisma.exceptionCase.create({ data: { dedupKey: "DUPLICATE_CIF:CIF-DEMO-023", type: "DUPLICATE_CIF", severity: "WARNING", customerId: "C-DEMO-023", title: "Customer master delivered two records for CIF-DEMO-023", evidence: { records: ["CIF-DEMO-023", "CIF-DEMO-023 (branch Sumgayit, 2019 record)"], action: "Canonical mapping required from customer master" } as never } });
  await prisma.exceptionCase.create({ data: { dedupKey: "STALE_FEATURES:C-SYN-0194", type: "STALE_FEATURES", severity: "WARNING", customerId: "C-SYN-0194", title: "Model features older than 45 days (snapshot 2026-07)", evidence: { observationMonth: "2026-07" } as never } });
  await prisma.exceptionCase.create({ data: { dedupKey: "MISSING_MODEL_INPUT:C-DEMO-019", type: "MISSING_MODEL_INPUT", severity: "WARNING", customerId: "C-DEMO-019", title: "No feature snapshot for a DPD 4-10 customer; kept in manual review", evidence: { segment: "DPD_4_10" } as never } });
}

function addDaysDate(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400000);
}

/** History, promises, support cases etc. must run after cases exist (post finalize step 1). */
export async function seedScenarioHistory(prisma: PrismaClient, rng: Rng) {
  const t = (iso: string, hm: string) => bakuDateTime(iso, hm);
  const yesterday = addDays(BUSINESS_DATE, -1);
  const d2 = addDays(BUSINESS_DATE, -2);
  const d3 = addDays(BUSINESS_DATE, -3);

  // 005 - verified RPC yesterday 14:00 → cooldown.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-005", agentUserId: "U-AGENT-C", at: t(yesterday, "14:00"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: "SALARY_TIMING", note: "Customer expects salary on the 5th; no commitment yet." });
  // 008 - wrong number yesterday → primary invalidated.
  const wrong = await seedHistoricalCall(prisma, { customerId: "C-DEMO-008", agentUserId: "U-AGENT-D", at: t(yesterday, "11:20"), technical: "ANSWERED", identity: "WRONG_NUMBER", outcome: "NO_CONVERSATION", note: "Number belongs to an unrelated person." });
  const cp8 = await prisma.contactPoint.findFirst({ where: { customerId: "C-DEMO-008", isPrimary: true } });
  if (cp8) await prisma.contactPoint.update({ where: { id: cp8.id }, data: { verification: "INVALID", invalidReason: "WRONG_NUMBER", invalidatedAt: t(yesterday, "11:25"), invalidatedByInteractionId: wrong?.id } });
  await prisma.exceptionCase.create({ data: { dedupKey: "WRONG_NUMBER:C-DEMO-008", type: "WRONG_NUMBER", severity: "INFO", customerId: "C-DEMO-008", title: "Primary mobile flagged as wrong number; alternative number unverified", evidence: { contactPointId: cp8?.id, alternative: "+994551000008 (unverified)" } as never } });
  // 009 - third-party answer yesterday.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-009", agentUserId: "U-AGENT-E", at: t(yesterday, "16:05"), technical: "ANSWERED", identity: "THIRD_PARTY", outcome: "NO_CONVERSATION", note: "Family member answered; asked customer to call back." });
  // 010 - failed attempt today 09:30.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-010", agentUserId: "U-AGENT-A", at: t(BUSINESS_DATE, "09:30"), technical: "NO_ANSWER" });
  // 011 - PTP obtained 24 Oct for 275 by 27 Oct, paid today 09:20 → KEPT.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-011", agentUserId: "U-AGENT-B", at: t(d3, "10:15"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "PTP", reason: "TEMPORARY_SHORTFALL", promise: { amount: "275.04", deadline: BUSINESS_DATE, loanId: "L-DEMO-011" } });
  // 012 - PTP 420 by 27 Oct, 150 paid today → PARTIALLY_PAID.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-012", agentUserId: "U-AGENT-C", at: t(d3, "11:40"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "PTP", reason: "SALARY_TIMING", promise: { amount: "420.00", deadline: BUSINESS_DATE, loanId: "L-DEMO-012" } });
  // 013 - PTP 180 by 26 Oct; feed uncertain → PENDING_RECONCILIATION.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-013", agentUserId: "U-AGENT-D", at: t(addDays(BUSINESS_DATE, -4), "15:10"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "PTP", reason: "FORGOT", promise: { amount: "180.00", deadline: yesterday, loanId: "L-DEMO-013" } });
  // 014 - PTP 325 by 25 Oct, nothing paid → BROKEN.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-014", agentUserId: "U-AGENT-E", at: t(addDays(BUSINESS_DATE, -6), "12:00"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "PTP", reason: "TEMPORARY_SHORTFALL", promise: { amount: "325.00", deadline: d2, loanId: "L-DEMO-014" } });
  // 015 - already-paid claim yesterday.
  const claimCall = await seedHistoricalCall(prisma, { customerId: "C-DEMO-015", agentUserId: "U-AGENT-F", at: t(yesterday, "10:45"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "ALREADY_PAID_CLAIM", reason: "TECHNICAL_PAYMENT_ISSUE", note: "Customer says 300 AZN paid at a terminal on 25 Oct, receipt ref TRM-55821." });
  // 016 - dispute raised 3 days ago.
  const disputeCall = await seedHistoricalCall(prisma, { customerId: "C-DEMO-016", agentUserId: "U-AGENT-B", at: t(d3, "14:30"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "DISPUTE", reason: "DISPUTED_DEBT", note: "Customer disputes the October installment amount." });
  // 017 - hardship referral 2 days ago.
  const supportCall = await seedHistoricalCall(prisma, { customerId: "C-DEMO-017", agentUserId: "U-AGENT-A", at: t(d2, "09:50"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "SUPPORT_NEEDED", reason: "INCOME_INTERRUPTION", note: "Job loss in September; requests a temporary reduced plan." });
  // 025 - RPC yesterday requesting a callback today 10:30.
  const cbCall = await seedHistoricalCall(prisma, { customerId: "C-DEMO-025", agentUserId: "U-AGENT-A", at: t(yesterday, "17:20"), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "CALLBACK_REQUESTED", reason: "NOT_STATED", note: "Customer asked to be called back tomorrow at 10:30 to confirm the payment plan." });
  // 029 - deceased notification referral.
  await seedHistoricalCall(prisma, { customerId: "C-DEMO-029", agentUserId: "U-AGENT-B", at: t(d3, "16:40"), technical: "ANSWERED", identity: "THIRD_PARTY", outcome: "SPECIAL_REFERRAL", note: "Relative informed us the customer is deceased; referred for special handling." });

  // Generic history across the last 5 business days for agent/team metrics (about 120 calls).
  const agents = ["U-AGENT-A", "U-AGENT-B", "U-AGENT-C", "U-AGENT-D", "U-AGENT-E", "U-AGENT-F"];
  const candidates = await prisma.customer.findMany({ where: { id: { startsWith: "C-SYN-" }, cases: { some: { status: "OPEN" } } }, select: { id: true, loans: { select: { id: true } } } });
  const days = [addDays(BUSINESS_DATE, -5), addDays(BUSINESS_DATE, -4), d3, d2, yesterday, BUSINESS_DATE];
  let n = 0;
  for (let i = 0; i < 130 && i < candidates.length; i++) {
    const c = candidates[(i * 7) % candidates.length];
    const day = days[i % days.length];
    if (day === BUSINESS_DATE && i % 3 !== 0) continue; // only some calls today before 10:00
    const hour = day === BUSINESS_DATE ? "09" : String(9 + (i % 8)).padStart(2, "0");
    const minute = String((i * 13) % 60).padStart(2, "0");
    const agent = agents[i % agents.length];
    const roll = rng.next();
    if (roll < 0.42) {
      await seedHistoricalCall(prisma, { customerId: c.id, agentUserId: agent, at: t(day, `${hour}:${minute}`), technical: rng.pick(["NO_ANSWER", "BUSY", "UNREACHABLE", "MACHINE"] as const) });
    } else if (roll < 0.52) {
      await seedHistoricalCall(prisma, { customerId: c.id, agentUserId: agent, at: t(day, `${hour}:${minute}`), technical: "ANSWERED", identity: "THIRD_PARTY", outcome: "NO_CONVERSATION" });
    } else if (roll < 0.78) {
      await seedHistoricalCall(prisma, { customerId: c.id, agentUserId: agent, at: t(day, `${hour}:${minute}`), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "NO_COMMITMENT", reason: rng.pick(["SALARY_TIMING", "TEMPORARY_SHORTFALL", "FORGOT", "NOT_STATED"] as const) });
    } else {
      const loanId = c.loans[0]?.id;
      if (!loanId) continue;
      await seedHistoricalCall(prisma, { customerId: c.id, agentUserId: agent, at: t(day, `${hour}:${minute}`), technical: "ANSWERED", identity: "RPC_VERIFIED", outcome: "PTP", reason: rng.pick(["SALARY_TIMING", "TEMPORARY_SHORTFALL"] as const), promise: { amount: rng.money(80, 600, 10), deadline: addDays(day, rng.int(2, 6)), loanId } });
    }
    n++;
  }

  // Support cases, claims, arrangements, callbacks, tasks.
  await prisma.paymentClaim.create({ data: { customerId: "C-DEMO-015", loanId: "L-DEMO-015", interactionId: claimCall?.id, claimedAmount: "300.00", claimedDate: toDbDate(d2), channel: "Payment terminal", reference: "TRM-55821", status: "OPEN", holdUntil: new Date(t(yesterday, "10:45").getTime() + 48 * 3600000) } });
  await prisma.supportCase.create({ data: { id: "SC-DISPUTE-016", customerId: "C-DEMO-016", type: "DISPUTE", status: "OPEN", reason: "Customer disputes October installment amount", interactionId: disputeCall?.id, ownerUserId: "U-LEAD", createdBy: "U-AGENT-B", slaDueAt: addDaysDate(SEED_NOW, 3) } });
  await prisma.supportCase.create({ data: { id: "SC-HARDSHIP-017", customerId: "C-DEMO-017", type: "HARDSHIP", status: "UNDER_REVIEW", reason: "Income interruption; requests temporary reduced plan", restrictedDetails: { income: "restricted", expenses: "restricted", evidence: "employment termination letter (synthetic)" } as never, interactionId: supportCall?.id, ownerUserId: "U-LEAD", createdBy: "U-AGENT-A", restrictionUntil: addDaysDate(SEED_NOW, 14), slaDueAt: addDaysDate(SEED_NOW, 5) } });
  await prisma.supportCase.create({ data: { id: "SC-LEGAL-029", customerId: "C-DEMO-029", type: "DECEASED_LEGAL", status: "OPEN", reason: "Deceased notification; legal/estate handling", ownerUserId: "U-LEAD", createdBy: "U-AGENT-B", restrictsCalls: true } });
  await prisma.arrangement.create({ data: { customerId: "C-DEMO-017", supportCaseId: "SC-HARDSHIP-017", type: "TEMPORARY_PLAN", status: "SUBMITTED", intake: { reason: "Income interruption", monthlyIncome: "restricted", monthlyExpenses: "restricted", disposableIncome: "restricted", proposedAffordable: "150.00" } as never, proposal: { monthlyPayment: "150.00", months: 3, note: "Temporary reduced plan; contract unchanged; arrears not capitalized" } as never, createdBy: "U-AGENT-A", reviewerUserId: "U-LEAD" } });

  // Fix promise states for scenario customers (payment attribution is demonstrated live by the runtime; seed sets the matured states).
  const p11 = await prisma.promise.findFirst({ where: { customerId: "C-DEMO-011" } });
  const pay11 = await prisma.payment.findFirst({ where: { sourceTransactionId: "DEMO-TXN-011-PTP" } });
  if (p11 && pay11) {
    await prisma.promise.update({ where: { id: p11.id }, data: { status: "KEPT", paidAmount: "275.04", remainingAmount: "0.00", maturedAt: pay11.eventAt, paymentLinks: { create: { paymentId: pay11.id, amount: "275.04" } }, events: { create: { type: "PAYMENT_ATTRIBUTED", fromStatus: "ACTIVE", toStatus: "KEPT", data: { paymentId: pay11.id, amount: "275.04" } as never } } } });
  }
  const p12 = await prisma.promise.findFirst({ where: { customerId: "C-DEMO-012" } });
  const pay12 = await prisma.payment.findFirst({ where: { sourceTransactionId: "DEMO-TXN-012-PART" } });
  if (p12 && pay12) {
    await prisma.promise.update({ where: { id: p12.id }, data: { status: "PARTIALLY_PAID", paidAmount: "150.00", remainingAmount: "270.00", paymentLinks: { create: { paymentId: pay12.id, amount: "150.00" } }, events: { create: { type: "PAYMENT_ATTRIBUTED", fromStatus: "ACTIVE", toStatus: "PARTIALLY_PAID", data: { paymentId: pay12.id, amount: "150.00" } as never } } } });
  }
  const p13 = await prisma.promise.findFirst({ where: { customerId: "C-DEMO-013" } });
  if (p13) await prisma.promise.update({ where: { id: p13.id }, data: { status: "PENDING_RECONCILIATION", maturedAt: t(yesterday, "23:59"), events: { create: { type: "MATURED", fromStatus: "ACTIVE", toStatus: "PENDING_RECONCILIATION", reason: "Deadline reached; payment feed coverage for the settlement window not yet confirmed" } } } });
  const p14 = await prisma.promise.findFirst({ where: { customerId: "C-DEMO-014" } });
  if (p14) await prisma.promise.update({ where: { id: p14.id }, data: { status: "BROKEN", maturedAt: t(d2, "23:59"), suppressionUntil: null, events: { create: { type: "MATURED", fromStatus: "ACTIVE", toStatus: "BROKEN", reason: "No qualifying payment within the settlement allowance" } } } });
  // Generic promises with deadlines in the past and no payment → BROKEN; keep others ACTIVE.
  const matured = await prisma.promise.findMany({ where: { status: "ACTIVE", deadline: { lt: new Date(SEED_NOW.getTime() - 2 * 86400000) } } });
  for (const p of matured) await prisma.promise.update({ where: { id: p.id }, data: { status: "BROKEN", maturedAt: new Date(p.deadline.getTime() + 2 * 86400000), suppressionUntil: null } });

  // A few SMS reminders already sent today from the local outbox (buckets 1-7).
  const smsTargets = await prisma.customer.findMany({ where: { id: { in: ["C-DEMO-026", "C-SYN-0160", "C-SYN-0161", "C-SYN-0162"] } }, include: { contactPoints: true } });
  for (const c of smsTargets) {
    const cp = c.contactPoints.find((x) => x.type === "MOBILE");
    await prisma.outboundMessage.create({ data: { dedupKey: `SMS_REMINDER_DAILY:${c.id}:${BUSINESS_DATE}`, campaignId: "CMP-SMS", customerId: c.id, contactPointId: cp?.id, templateId: `TPL-SMS-01-${c.language}`, language: c.language, body: "ATB: reminder (synthetic, local outbox only)", status: "SENT", providerRef: `local-outbox-${c.id}`, requestedAt: t(BUSINESS_DATE, "09:05"), sentAt: t(BUSINESS_DATE, "09:05") } });
  }
  return { cbCall, n, dec: dec("0").toString() };
}
