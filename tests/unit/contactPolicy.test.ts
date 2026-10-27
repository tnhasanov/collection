import { describe, expect, it } from "vitest";
import { evaluateContactPolicy, nextPermittedTime, ptpProtectionEnd, rpcCooldownEnd, type PolicyContext } from "@/server/modules/contactPolicy/evaluator";
import { DEMO_CONTACT_POLICY } from "@/server/modules/contactPolicy/types";

const T = (iso: string) => new Date(iso);
// 27 Oct 2026 10:00 Baku = 06:00Z
const NOW = T("2026-10-27T06:00:00.000Z");

function ctx(overrides: Partial<PolicyContext> = {}): PolicyContext {
  const now = overrides.now ?? NOW;
  const fresh = new Date(now.getTime() - 2 * 60_000);
  return {
    now,
    policy: DEMO_CONTACT_POLICY,
    channel: "VOICE",
    customer: { id: "C1", status: "ACTIVE", specialHandling: false },
    loans: [{ id: "L1", status: "ACTIVE", totalOverdue: "499.24", balancesAsOf: fresh }],
    sourceFreshness: { paymentFeedAsOf: fresh, paymentFeedHealthy: true },
    contactPoint: { id: "CP1", verification: "VERIFIED", restricted: false, type: "MOBILE" },
    openDispute: false,
    supportHoldUntil: null,
    legalOrDeceased: false,
    paidClaimHoldUntil: null,
    lastRpcAt: null,
    activePromise: null,
    voiceAttemptsToday: 0,
    voiceAttemptsThisWeek: 0,
    failedAttemptsInCycle: 0,
    lastFailedAttemptAt: null,
    actionBucket: 10,
    routineCallAllowed: true,
    capacityGated: false,
    hasSpareCapacity: true,
    dueCallback: null,
    activeReservationByOther: false,
    strategyActive: true,
    modelValid: true,
    killSwitch: false,
    channelPaused: false,
    smsSentToday: 0,
    smsSentThisWeek: 0,
    ...overrides,
  };
}

describe("contact policy evaluator (acceptance cases 9-11, 14-16)", () => {
  it("is eligible in the clean case", () => {
    const d = evaluateContactPolicy(ctx());
    expect(d.eligible).toBe(true);
    expect(d.reasonCodes).toEqual([]);
    expect(d.policyVersion).toBe("CONTACT_POLICY/DEMO-01");
  });

  it("suppresses routine calls for 120 hours after a verified RPC (27 Oct 10:00 → 1 Nov 10:00 Baku)", () => {
    const rpc = T("2026-10-27T06:00:00.000Z");
    expect(rpcCooldownEnd(rpc, DEMO_CONTACT_POLICY).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    const blocked = evaluateContactPolicy(ctx({ lastRpcAt: rpc, now: T("2026-10-30T06:00:00.000Z") }));
    expect(blocked.eligible).toBe(false);
    expect(blocked.reasonCodes).toContain("RPC_COOLDOWN");
    expect(blocked.nextAllowedAt?.toISOString()).toBe("2026-11-01T06:00:00.000Z");
    // 1 Nov 2026 is a Sunday: the cooldown ends then, but permitted days make the next allowed call Monday 2 Nov 09:00.
    const after = evaluateContactPolicy(ctx({ lastRpcAt: rpc, now: T("2026-11-02T06:00:00.000Z") }));
    expect(after.eligible).toBe(true);
  });

  it("protects an active PTP until the later of cooldown end and deadline + allowance", () => {
    const rpc = T("2026-10-27T06:00:00.000Z");
    const deadline = T("2026-10-30T15:59:59.000Z"); // 30 Oct end of day Baku
    const end = ptpProtectionEnd(deadline, rpc, DEMO_CONTACT_POLICY);
    expect(end.toISOString()).toBe("2026-11-01T15:59:59.000Z");
    // Saturday 31 Oct 10:00 Baku is a permitted time; cooldown and promise protection both still apply.
    const d = evaluateContactPolicy(ctx({ lastRpcAt: rpc, activePromise: { deadline, suppressionUntil: end, status: "ACTIVE" }, now: T("2026-10-31T06:00:00.000Z") }));
    expect(d.reasonCodes).toContain("PTP_PROTECTION");
    expect(d.reasonCodes).toContain("RPC_COOLDOWN");
    expect(d.nextAllowedAt?.toISOString()).toBe("2026-11-01T15:59:59.000Z");
    // On Sunday 1 Nov the permitted-day rule is the later restriction (Monday 2 Nov 09:00 Baku).
    const sunday = evaluateContactPolicy(ctx({ lastRpcAt: rpc, activePromise: { deadline, suppressionUntil: end, status: "ACTIVE" }, now: T("2026-11-01T10:00:00.000Z") }));
    expect(sunday.nextAllowedAt?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("blocks stale payment data and no-arrears customers before anything else", () => {
    const stale = evaluateContactPolicy(ctx({ sourceFreshness: { paymentFeedAsOf: T("2026-10-27T04:00:00.000Z"), paymentFeedHealthy: true } }));
    expect(stale.eligible).toBe(false);
    expect(stale.reasonCodes).toContain("PAYMENT_FEED_FRESH");
    const paid = evaluateContactPolicy(ctx({ loans: [{ id: "L1", status: "ACTIVE", totalOverdue: "0.00", balancesAsOf: NOW }] }));
    expect(paid.reasonCodes).toContain("ARREARS_PRESENT");
  });

  it("blocks wrong numbers, disputes, support holds and paid-claim holds", () => {
    expect(evaluateContactPolicy(ctx({ contactPoint: { id: "CP1", verification: "INVALID", restricted: false, type: "MOBILE" } })).reasonCodes).toContain("CONTACT_VALID");
    expect(evaluateContactPolicy(ctx({ openDispute: true })).reasonCodes).toContain("NO_OPEN_DISPUTE");
    expect(evaluateContactPolicy(ctx({ supportHoldUntil: T("2026-11-05T00:00:00Z") })).reasonCodes).toContain("NO_SUPPORT_HOLD");
    expect(evaluateContactPolicy(ctx({ paidClaimHoldUntil: T("2026-10-29T06:00:00Z") })).reasonCodes).toContain("NO_PAID_CLAIM_HOLD");
  });

  it("applies bucket retry timing and refuses routine calls for low buckets", () => {
    const failedAt = T("2026-10-27T05:30:00.000Z"); // 09:30 Baku today
    const b10 = evaluateContactPolicy(ctx({ actionBucket: 10, lastFailedAttemptAt: failedAt, failedAttemptsInCycle: 1 }));
    expect(b10.reasonCodes).toContain("RETRY_TIMING");
    expect(b10.nextAllowedAt?.toISOString()).toBe("2026-10-27T08:30:00.000Z"); // +3h same day
    const b10later = evaluateContactPolicy(ctx({ actionBucket: 10, lastFailedAttemptAt: failedAt, failedAttemptsInCycle: 1, now: T("2026-10-27T09:00:00.000Z") }));
    expect(b10later.eligible).toBe(true);
    const b8 = evaluateContactPolicy(ctx({ actionBucket: 8, lastFailedAttemptAt: failedAt, failedAttemptsInCycle: 1 }));
    expect(b8.nextAllowedAt?.toISOString()).toBe("2026-10-28T05:00:00.000Z"); // next day 09:00 Baku
    const b7 = evaluateContactPolicy(ctx({ actionBucket: 7, lastFailedAttemptAt: failedAt, failedAttemptsInCycle: 1, capacityGated: true, hasSpareCapacity: false }));
    expect(b7.nextAllowedAt?.toISOString()).toBe("2026-10-29T05:00:00.000Z");
    expect(b7.reasonCodes).toContain("CAPACITY_AVAILABLE");
    const b5 = evaluateContactPolicy(ctx({ actionBucket: 5, routineCallAllowed: false }));
    expect(b5.reasonCodes).toContain("ROUTINE_CALL_ALLOWED");
    const limit = evaluateContactPolicy(ctx({ actionBucket: 10, failedAttemptsInCycle: 4 }));
    expect(limit.reasonCodes).toContain("FAILED_ATTEMPT_LIMIT");
  });

  it("enforces quiet hours, permitted days and attempt caps", () => {
    const night = evaluateContactPolicy(ctx({ now: T("2026-10-27T17:30:00.000Z") })); // 21:30 Baku
    expect(night.reasonCodes).toContain("PERMITTED_HOURS");
    expect(night.nextAllowedAt?.toISOString()).toBe("2026-10-28T05:00:00.000Z");
    expect(nextPermittedTime(T("2026-11-01T06:00:00.000Z"), DEMO_CONTACT_POLICY).toISOString()).toBe("2026-11-02T05:00:00.000Z"); // Sunday → Monday 09:00
    expect(evaluateContactPolicy(ctx({ voiceAttemptsToday: 2 })).reasonCodes).toContain("DAILY_ATTEMPT_CAP");
    expect(evaluateContactPolicy(ctx({ voiceAttemptsThisWeek: 6 })).reasonCodes).toContain("WEEKLY_ATTEMPT_CAP");
  });

  it("uses the later permitted time when several restrictions apply", () => {
    const d = evaluateContactPolicy(ctx({ lastRpcAt: T("2026-10-27T06:00:00.000Z"), paidClaimHoldUntil: T("2026-11-03T06:00:00.000Z"), now: T("2026-10-28T06:00:00.000Z") }));
    expect(d.nextAllowedAt?.toISOString()).toBe("2026-11-03T06:00:00.000Z");
  });

  it("allows a due customer-requested callback inside cooldown only under the narrow exception, never past hard blocks", () => {
    const rpc = T("2026-10-27T06:00:00.000Z");
    const cb = { dueAt: T("2026-10-28T06:00:00.000Z"), customerRequested: true };
    const ok = evaluateContactPolicy(ctx({ lastRpcAt: rpc, dueCallback: cb, now: T("2026-10-28T06:00:00.000Z") }));
    expect(ok.eligible).toBe(true);
    const disputed = evaluateContactPolicy(ctx({ lastRpcAt: rpc, dueCallback: cb, openDispute: true, now: T("2026-10-28T06:00:00.000Z") }));
    expect(disputed.eligible).toBe(false);
    const notRequested = evaluateContactPolicy(ctx({ lastRpcAt: rpc, dueCallback: { ...cb, customerRequested: false }, now: T("2026-10-28T06:00:00.000Z") }));
    expect(notRequested.reasonCodes).toContain("RPC_COOLDOWN");
  });

  it("blocks execution without an active strategy, with a kill switch, or when reserved elsewhere", () => {
    expect(evaluateContactPolicy(ctx({ strategyActive: false })).reasonCodes).toContain("STRATEGY_ACTIVE");
    expect(evaluateContactPolicy(ctx({ killSwitch: true })).reasonCodes).toContain("KILL_SWITCH");
    expect(evaluateContactPolicy(ctx({ activeReservationByOther: true })).reasonCodes).toContain("NOT_RESERVED_ELSEWHERE");
  });

  it("evaluates SMS with its own limits and without voice cooldown", () => {
    const sms = evaluateContactPolicy(ctx({ channel: "SMS", lastRpcAt: T("2026-10-27T05:00:00.000Z"), smsSentToday: 0 }));
    expect(sms.eligible).toBe(true);
    expect(evaluateContactPolicy(ctx({ channel: "SMS", smsSentToday: 1 })).reasonCodes).toContain("SMS_DAILY_LIMIT");
  });
});
