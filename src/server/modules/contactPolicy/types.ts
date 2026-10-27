/** Versioned contact-policy configuration. Every value is a labeled demo assumption unless marked otherwise. */
export interface RetryRule {
  /** Hours to wait before a same-day retry (null = no same-day retry). */
  sameDayAfterHours: number | null;
  /** Calendar days to wait for the next retry when no same-day retry applies. */
  nextRetryDays: number;
  /** Only when spare capacity exists (bucket 7 source rule). */
  capacityGated: boolean;
  /** Buckets 1-6: no routine agent call. */
  routineCallAllowed: boolean;
}

export interface ContactPolicyConfig {
  code: string;
  version: string;
  /** Minimum five-day agent-call cooldown after a verified right-party conversation (source), demo convention 120 hours. */
  rpcCooldownHours: number;
  /** PTP protection: no routine calls until the later of cooldown end and deadline + settlement allowance (proposal). */
  ptpProtectionEnabled: boolean;
  ptpSettlementAllowanceDays: number;
  quietHours: { start: string; end: string };
  permittedWeekdays: number[]; // 1 = Monday .. 7 = Sunday (Luxon)
  holidays: string[]; // ISO dates; empty in the demo - no Azerbaijani legal holiday list is asserted
  maxVoiceAttemptsPerDay: number;
  maxVoiceAttemptsPerWeek: number;
  maxFailedAttemptsPerCycle: number;
  retryRulesByBucket: Record<string, RetryRule>;
  paidClaimHoldHours: number;
  disputeBlocksCalls: boolean;
  supportCaseBlocksCalls: boolean;
  wrongNumberBlocksContact: boolean;
  /** Narrow, evidenced customer-requested callback exception during cooldown (demo assumption, requires policy approval). */
  customerRequestedCallbackException: boolean;
  balanceFreshnessThresholdMinutes: number;
  paymentFeedFreshnessThresholdMinutes: number;
  featureSnapshotMaxAgeDays: number;
  smsDailyLimit: number;
  smsWeeklyLimit: number;
}

export const DEMO_CONTACT_POLICY: ContactPolicyConfig = {
  code: "CONTACT_POLICY",
  version: "DEMO-01",
  rpcCooldownHours: 120,
  ptpProtectionEnabled: true,
  ptpSettlementAllowanceDays: 2,
  quietHours: { start: "20:00", end: "09:00" },
  permittedWeekdays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  maxVoiceAttemptsPerDay: 2,
  maxVoiceAttemptsPerWeek: 6,
  maxFailedAttemptsPerCycle: 4,
  retryRulesByBucket: {
    "10": { sameDayAfterHours: 3, nextRetryDays: 1, capacityGated: false, routineCallAllowed: true },
    "9": { sameDayAfterHours: 3, nextRetryDays: 1, capacityGated: false, routineCallAllowed: true },
    "8": { sameDayAfterHours: null, nextRetryDays: 1, capacityGated: false, routineCallAllowed: true },
    "7": { sameDayAfterHours: null, nextRetryDays: 2, capacityGated: true, routineCallAllowed: true },
    "6": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
    "5": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
    "4": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
    "3": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
    "2": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
    "1": { sameDayAfterHours: null, nextRetryDays: 0, capacityGated: false, routineCallAllowed: false },
  },
  paidClaimHoldHours: 48,
  disputeBlocksCalls: true,
  supportCaseBlocksCalls: true,
  wrongNumberBlocksContact: true,
  customerRequestedCallbackException: true,
  balanceFreshnessThresholdMinutes: 15,
  paymentFeedFreshnessThresholdMinutes: 15,
  featureSnapshotMaxAgeDays: 45,
  smsDailyLimit: 1,
  smsWeeklyLimit: 3,
};
