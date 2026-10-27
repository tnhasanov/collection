import { DateTime } from "luxon";
import { BAKU_ZONE, addHours, bakuBusinessDate, type IsoDate } from "@/server/dates";
import type { ContactPolicyConfig } from "@/server/modules/contactPolicy/types";

/**
 * Single server-side contact-policy evaluator. It runs at queue creation, task claim/reservation,
 * immediately before dispatch, on manual actions and on campaign dispatch. A UI control cannot bypass it.
 * Precedence: paid/cured/closed → stale critical data → contact validity → dispute/legal/support →
 * frequency/time restrictions → verified-contact cooldown → active PTP → retry timing → capacity/skill.
 * Where several restrictions apply, the later permitted time and the stronger restriction win.
 */
export type RequestedChannel = "VOICE" | "SMS";

export interface PolicyContext {
  now: Date;
  policy: ContactPolicyConfig;
  channel: RequestedChannel;
  customer: { id: string; status: string; specialHandling: boolean };
  loans: { id: string; status: string; totalOverdue: string; balancesAsOf: Date }[];
  sourceFreshness: { paymentFeedAsOf: Date | null; paymentFeedHealthy: boolean };
  contactPoint: { id: string; verification: string; restricted: boolean; type: string } | null;
  openDispute: boolean;
  supportHoldUntil: Date | null;
  legalOrDeceased: boolean;
  paidClaimHoldUntil: Date | null;
  lastRpcAt: Date | null;
  activePromise: { deadline: Date; suppressionUntil: Date | null; status: string } | null;
  voiceAttemptsToday: number;
  voiceAttemptsThisWeek: number;
  failedAttemptsInCycle: number;
  lastFailedAttemptAt: Date | null;
  actionBucket: number | null;
  routineCallAllowed: boolean;
  capacityGated: boolean;
  hasSpareCapacity: boolean;
  /** A due callback owned by this agent/queue, optionally customer-requested (narrow exception). */
  dueCallback: { dueAt: Date; customerRequested: boolean } | null;
  activeReservationByOther: boolean;
  strategyActive: boolean;
  modelValid: boolean;
  killSwitch: boolean;
  channelPaused: boolean;
  smsSentToday: number;
  smsSentThisWeek: number;
  isManualOverride?: boolean;
}

export interface PolicyCheck {
  code: string;
  passed: boolean;
  detail?: string;
  blockedUntil?: Date;
}

export interface PolicyDecision {
  eligible: boolean;
  reasonCodes: string[];
  nextAllowedAt: Date | null;
  policyVersion: string;
  checks: PolicyCheck[];
  evaluatedAt: Date;
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Returns the next instant inside permitted hours/days (or `at` if already permitted). */
export function nextPermittedTime(at: Date, policy: ContactPolicyConfig): Date {
  let cursor = DateTime.fromJSDate(at, { zone: BAKU_ZONE });
  const start = parseHm(policy.quietHours.end); // quiet ends → permitted start
  const end = parseHm(policy.quietHours.start); // permitted ends → quiet start
  for (let guard = 0; guard < 14; guard++) {
    const minutes = cursor.hour * 60 + cursor.minute;
    const dayOk = policy.permittedWeekdays.includes(cursor.weekday) && !policy.holidays.includes(cursor.toISODate() as IsoDate);
    if (dayOk && minutes >= start && minutes < end) return cursor.toJSDate();
    if (dayOk && minutes < start) {
      cursor = cursor.set({ hour: Math.floor(start / 60), minute: start % 60, second: 0, millisecond: 0 });
      return cursor.toJSDate();
    }
    cursor = cursor.plus({ days: 1 }).set({ hour: Math.floor(start / 60), minute: start % 60, second: 0, millisecond: 0 });
  }
  return cursor.toJSDate();
}

export function isWithinPermittedHours(at: Date, policy: ContactPolicyConfig): boolean {
  return nextPermittedTime(at, policy).getTime() === at.getTime();
}

export function rpcCooldownEnd(lastRpcAt: Date, policy: ContactPolicyConfig): Date {
  return addHours(lastRpcAt, policy.rpcCooldownHours);
}

export function ptpProtectionEnd(promiseDeadline: Date, lastRpcAt: Date | null, policy: ContactPolicyConfig): Date {
  const allowance = addHours(promiseDeadline, policy.ptpSettlementAllowanceDays * 24);
  const cooldown = lastRpcAt ? rpcCooldownEnd(lastRpcAt, policy) : allowance;
  return cooldown.getTime() > allowance.getTime() ? cooldown : allowance;
}

export function evaluateContactPolicy(ctx: PolicyContext): PolicyDecision {
  const checks: PolicyCheck[] = [];
  const p = ctx.policy;
  const now = ctx.now;
  const push = (code: string, passed: boolean, detail?: string, blockedUntil?: Date) => checks.push({ code, passed, detail, blockedUntil });

  // 0. Global controls
  push("KILL_SWITCH", !ctx.killSwitch, ctx.killSwitch ? "Outbound execution is paused by the kill switch" : undefined);
  push("CHANNEL_PAUSED", !ctx.channelPaused, ctx.channelPaused ? `${ctx.channel} channel paused by an operator` : undefined);
  push("STRATEGY_ACTIVE", ctx.strategyActive, ctx.strategyActive ? undefined : "No approved active strategy drives execution");
  push("MODEL_VALID", ctx.modelValid, ctx.modelValid ? undefined : "Model/policy version expired or unapproved for this decision");

  // 1. Paid / cured / closed
  const anyOverdue = ctx.loans.some((l) => l.status === "ACTIVE" && Number(l.totalOverdue) > 0);
  push("ARREARS_PRESENT", anyOverdue, anyOverdue ? undefined : "No overdue balance on any active loan (paid, cured or closed)");

  // 2. Stale critical financial data
  const balanceAges = ctx.loans.map((l) => (now.getTime() - l.balancesAsOf.getTime()) / 60_000);
  const balancesStale = balanceAges.some((age) => age > p.balanceFreshnessThresholdMinutes);
  push("BALANCES_FRESH", !balancesStale, balancesStale ? `Loan balances older than ${p.balanceFreshnessThresholdMinutes} min` : undefined);
  const feedAge = ctx.sourceFreshness.paymentFeedAsOf ? (now.getTime() - ctx.sourceFreshness.paymentFeedAsOf.getTime()) / 60_000 : Infinity;
  const feedStale = !ctx.sourceFreshness.paymentFeedHealthy || feedAge > p.paymentFeedFreshnessThresholdMinutes;
  push("PAYMENT_FEED_FRESH", !feedStale, feedStale ? "Payment feed stale or unhealthy; amount-specific outreach blocked until refreshed" : undefined);

  // 3. Identity / contact validity
  if (ctx.channel === "VOICE" || ctx.channel === "SMS") {
    const cp = ctx.contactPoint;
    const valid = !!cp && cp.verification !== "INVALID" && !cp.restricted;
    push("CONTACT_VALID", valid, valid ? undefined : cp ? (cp.restricted ? "Contact point restricted" : "Contact point invalid (wrong number)") : "No usable contact point");
  }
  push("CUSTOMER_STATUS", !ctx.legalOrDeceased && ctx.customer.status === "ACTIVE", ctx.legalOrDeceased ? "Legal / deceased notification: special handling only" : ctx.customer.status !== "ACTIVE" ? `Customer status ${ctx.customer.status}` : undefined);

  // 4. Dispute / support / paid-claim holds
  push("NO_OPEN_DISPUTE", !(p.disputeBlocksCalls && ctx.openDispute), ctx.openDispute ? "Open dispute: specialist review before outreach" : undefined);
  const supportBlocked = p.supportCaseBlocksCalls && !!ctx.supportHoldUntil && ctx.supportHoldUntil.getTime() > now.getTime();
  push("NO_SUPPORT_HOLD", !supportBlocked, supportBlocked ? "Support/hardship case hold" : undefined, supportBlocked ? ctx.supportHoldUntil! : undefined);
  const claimBlocked = !!ctx.paidClaimHoldUntil && ctx.paidClaimHoldUntil.getTime() > now.getTime();
  push("NO_PAID_CLAIM_HOLD", !claimBlocked, claimBlocked ? "Already-paid claim awaiting reconciliation" : undefined, claimBlocked ? ctx.paidClaimHoldUntil! : undefined);

  // 5. Customer-level frequency and time restrictions
  if (ctx.channel === "VOICE") {
    const permitted = isWithinPermittedHours(now, p);
    push("PERMITTED_HOURS", permitted, permitted ? undefined : "Outside permitted calling hours/days", permitted ? undefined : nextPermittedTime(now, p));
    const dayCapOk = ctx.voiceAttemptsToday < p.maxVoiceAttemptsPerDay;
    push("DAILY_ATTEMPT_CAP", dayCapOk, dayCapOk ? undefined : `Daily voice attempt cap (${p.maxVoiceAttemptsPerDay}) reached`, dayCapOk ? undefined : nextPermittedTime(DateTime.fromJSDate(now, { zone: BAKU_ZONE }).plus({ days: 1 }).startOf("day").toJSDate(), p));
    const weekCapOk = ctx.voiceAttemptsThisWeek < p.maxVoiceAttemptsPerWeek;
    push("WEEKLY_ATTEMPT_CAP", weekCapOk, weekCapOk ? undefined : `Weekly voice attempt cap (${p.maxVoiceAttemptsPerWeek}) reached`, weekCapOk ? undefined : nextPermittedTime(DateTime.fromJSDate(now, { zone: BAKU_ZONE }).plus({ weeks: 1 }).startOf("week").toJSDate(), p));
  } else {
    const dayOk = ctx.smsSentToday < p.smsDailyLimit;
    push("SMS_DAILY_LIMIT", dayOk, dayOk ? undefined : "SMS daily limit reached");
    const weekOk = ctx.smsSentThisWeek < p.smsWeeklyLimit;
    push("SMS_WEEKLY_LIMIT", weekOk, weekOk ? undefined : "SMS weekly limit reached");
  }

  // 6. Verified-contact cooldown (voice only; digital reminders follow their own limits)
  const callbackException = ctx.channel === "VOICE" && !!ctx.dueCallback && ctx.dueCallback.customerRequested && p.customerRequestedCallbackException && ctx.dueCallback.dueAt.getTime() <= now.getTime();
  if (ctx.channel === "VOICE") {
    const cooldownEnd = ctx.lastRpcAt ? rpcCooldownEnd(ctx.lastRpcAt, p) : null;
    const inCooldown = !!cooldownEnd && cooldownEnd.getTime() > now.getTime();
    const blocked = inCooldown && !callbackException;
    push("RPC_COOLDOWN", !blocked, blocked ? `Verified contact cooldown (${p.rpcCooldownHours}h) until ${cooldownEnd!.toISOString()}` : inCooldown ? "In cooldown but customer-requested callback exception applies" : undefined, blocked ? cooldownEnd! : undefined);

    // 7. Active PTP protection
    if (p.ptpProtectionEnabled && ctx.activePromise && ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"].includes(ctx.activePromise.status)) {
      const protectionEnd = ctx.activePromise.suppressionUntil ?? ptpProtectionEnd(ctx.activePromise.deadline, ctx.lastRpcAt, p);
      const ptpBlocked = protectionEnd.getTime() > now.getTime() && !callbackException;
      push("PTP_PROTECTION", !ptpBlocked, ptpBlocked ? `Active promise protected until ${protectionEnd.toISOString()}` : undefined, ptpBlocked ? protectionEnd : undefined);
    }

    // 8. Retry timing and routine-call permission by bucket
    if (!ctx.dueCallback) {
      push("ROUTINE_CALL_ALLOWED", ctx.routineCallAllowed, ctx.routineCallAllowed ? undefined : `No routine agent call for action bucket ${ctx.actionBucket ?? "n/a"} / treatment`);
      const rule = ctx.actionBucket ? p.retryRulesByBucket[String(ctx.actionBucket)] : undefined;
      if (ctx.lastFailedAttemptAt && rule && ctx.routineCallAllowed) {
        const lastDay = bakuBusinessDate(ctx.lastFailedAttemptAt);
        const today = bakuBusinessDate(now);
        let retryAt: Date;
        if (rule.sameDayAfterHours !== null && lastDay === today) {
          retryAt = addHours(ctx.lastFailedAttemptAt, rule.sameDayAfterHours);
        } else {
          const days = rule.sameDayAfterHours !== null ? 1 : rule.nextRetryDays;
          retryAt = DateTime.fromISO(lastDay, { zone: BAKU_ZONE }).plus({ days }).startOf("day").toJSDate();
        }
        retryAt = nextPermittedTime(retryAt, p);
        const ok = retryAt.getTime() <= now.getTime();
        push("RETRY_TIMING", ok, ok ? undefined : `Bucket ${ctx.actionBucket} retry not before ${retryAt.toISOString()}`, ok ? undefined : retryAt);
      }
      const cycleOk = ctx.failedAttemptsInCycle < p.maxFailedAttemptsPerCycle;
      push("FAILED_ATTEMPT_LIMIT", cycleOk, cycleOk ? undefined : `Failed-attempt limit (${p.maxFailedAttemptsPerCycle}) reached for this cycle; manual review`);
      if (ctx.capacityGated) push("CAPACITY_AVAILABLE", ctx.hasSpareCapacity, ctx.hasSpareCapacity ? undefined : "Bucket 7: only with spare capacity");
    } else {
      const due = ctx.dueCallback.dueAt.getTime() <= now.getTime();
      push("CALLBACK_DUE", due, due ? undefined : "Callback not yet due", due ? undefined : ctx.dueCallback.dueAt);
    }
  }

  // 9. Concurrency
  push("NOT_RESERVED_ELSEWHERE", !ctx.activeReservationByOther, ctx.activeReservationByOther ? "Customer already reserved/claimed by another agent or campaign" : undefined);

  const failed = checks.filter((c) => !c.passed);
  const blockedUntil = failed.map((c) => c.blockedUntil).filter((d): d is Date => !!d);
  const nextAllowedAt = blockedUntil.length > 0 ? new Date(Math.max(...blockedUntil.map((d) => d.getTime()))) : null;
  return {
    eligible: failed.length === 0,
    reasonCodes: failed.map((c) => c.code),
    nextAllowedAt,
    policyVersion: `${p.code}/${p.version}`,
    checks,
    evaluatedAt: now,
  };
}

export const REASON_LABELS: Record<string, string> = {
  KILL_SWITCH: "Outbound paused (kill switch)",
  CHANNEL_PAUSED: "Channel paused",
  STRATEGY_ACTIVE: "No active approved strategy",
  MODEL_VALID: "Model/policy not valid",
  ARREARS_PRESENT: "No arrears (paid / cured)",
  BALANCES_FRESH: "Stale balance data",
  PAYMENT_FEED_FRESH: "Stale payment feed",
  CONTACT_VALID: "No valid contact",
  CUSTOMER_STATUS: "Customer status restriction",
  NO_OPEN_DISPUTE: "Open dispute",
  NO_SUPPORT_HOLD: "Support/hardship hold",
  NO_PAID_CLAIM_HOLD: "Paid claim under reconciliation",
  PERMITTED_HOURS: "Outside permitted hours",
  DAILY_ATTEMPT_CAP: "Daily attempt cap",
  WEEKLY_ATTEMPT_CAP: "Weekly attempt cap",
  SMS_DAILY_LIMIT: "SMS daily limit",
  SMS_WEEKLY_LIMIT: "SMS weekly limit",
  RPC_COOLDOWN: "Verified-contact cooldown",
  PTP_PROTECTION: "Active promise protected",
  ROUTINE_CALL_ALLOWED: "No routine call for this treatment",
  RETRY_TIMING: "Retry timing not reached",
  FAILED_ATTEMPT_LIMIT: "Failed-attempt limit reached",
  CAPACITY_AVAILABLE: "Awaiting spare capacity",
  CALLBACK_DUE: "Callback not yet due",
  NOT_RESERVED_ELSEWHERE: "Already claimed / reserved",
};
