import type { Provenance, Role } from "@/generated/prisma/enums";
import { DEMO_CONTACT_POLICY } from "@/server/modules/contactPolicy/types";

export interface SettingDefinition {
  key: string;
  group: string;
  value: unknown;
  provenance: Provenance;
  description: string;
  owner?: string;
  editableRoles?: Role[];
  effectiveFrom?: string;
}

const ADMIN_ONLY: Role[] = ["ADMIN"];
const POLICY_EDITORS: Role[] = ["COLLECTIONS_HEAD", "RISK_ANALYST", "ADMIN"];

/**
 * Product, policy, economics and capacity parameters with provenance. "SOURCE_BASED" values come from the
 * supplied Prometeia deck; "DEMO_ASSUMPTION" values are reversible placeholders that must be replaced by
 * bank-approved inputs before any pilot. Nothing here is asserted to be an Azerbaijani legal requirement.
 */
export const DEFAULT_SETTINGS: SettingDefinition[] = [
  // Product / financial conventions
  { key: "product.currency", group: "product", value: "AZN", provenance: "SOURCE_BASED", description: "Portfolio currency; no FX aggregation without an approved dated policy." },
  { key: "product.nominalRateLabel", group: "product", value: "Nominal annual rate", provenance: "DEMO_ASSUMPTION", description: "Display label; nominal rate is never labelled APR/EIR." },
  { key: "product.rounding", group: "product", value: "HALF_UP_CENTS_PER_COMPONENT_FINAL_ADJUST", provenance: "DEMO_ASSUMPTION", description: "Annuity rounding: AZN cents, half-up per component, final installment adjusted." },
  { key: "product.dueDatePolicy", group: "product", value: "SAME_DAY_CLAMP_NO_BUSINESS_DAY_SHIFT", provenance: "DEMO_ASSUMPTION", description: "Due dates keep the contractual day of month; no silent holiday/business-day shifting." },
  { key: "product.dpdToleranceAzn", group: "product", value: "0.00", provenance: "DEMO_ASSUMPTION", description: "Residual below this amount does not anchor DPD. Demo uses strict zero tolerance." },
  { key: "product.feesEnabled", group: "product", value: false, provenance: "DEMO_ASSUMPTION", description: "Fees/penalties are disabled until bank contract terms are supplied." },
  { key: "product.penaltyRate", group: "product", value: null, provenance: "DEMO_ASSUMPTION", description: "Unset. No generic country assumption becomes a contractual charge." },
  { key: "product.gracePeriodDays", group: "product", value: 0, provenance: "DEMO_ASSUMPTION", description: "No grace period assumed." },
  { key: "product.allocationPolicy", group: "product", value: "DEMO_OLDEST_DUE_FIRST_INTEREST_THEN_PRINCIPAL", provenance: "DEMO_ASSUMPTION", description: "Demo-only allocation for synthetic payments. Production uses imported core allocations." },
  { key: "product.holidayCalendar", group: "product", value: [], provenance: "DEMO_ASSUMPTION", description: "Holiday list is empty in the demo; supply the bank calendar before pilot." },

  // Contact policy
  { key: "contactPolicy.active", group: "contactPolicy", value: DEMO_CONTACT_POLICY, provenance: "DEMO_ASSUMPTION", description: "Active contact-policy parameters (cooldown 120h is the demo reading of the source's minimum 5 days).", editableRoles: POLICY_EDITORS },

  // Freshness thresholds
  { key: "freshness.balanceMinutes", group: "freshness", value: DEMO_CONTACT_POLICY.balanceFreshnessThresholdMinutes, provenance: "DEMO_ASSUMPTION", description: "Critical balance freshness threshold that blocks amount-specific outreach." },
  { key: "freshness.paymentFeedMinutes", group: "freshness", value: DEMO_CONTACT_POLICY.paymentFeedFreshnessThresholdMinutes, provenance: "DEMO_ASSUMPTION", description: "Payment feed freshness threshold." },
  { key: "freshness.featureSnapshotMaxAgeDays", group: "freshness", value: DEMO_CONTACT_POLICY.featureSnapshotMaxAgeDays, provenance: "DEMO_ASSUMPTION", description: "Latest complete monthly feature snapshot must be newer than this." },

  // Model / decision conventions
  { key: "model.segmentBoundaries", group: "model", value: { tree: [4, 10], band1: [11, 16], band2: [17, 23], band3: [24, 30], laterStage: 31 }, provenance: "DEMO_ASSUMPTION", description: "DPD 10 scored by the draft tree; 11-16/17-23/24-30 use draft roll rates. Source pages conflict ([10,17) versus 11-30); confirmation required." },
  { key: "model.draftRollRates", group: "model", value: { DPD_11_16: "0.198", DPD_17_23: "0.269", DPD_24_30: "0.337" }, provenance: "SOURCE_BASED", description: "Draft empirical roll rates from the deck (10+ DPD segment table). Exact target threshold to be clarified." },
  { key: "model.selfCurePreferenceDpd1to3", group: "model", value: true, provenance: "SOURCE_BASED", description: "1-3 DPD emphasizes self-cure and approved digital reminders; separately configurable." },
  { key: "model.exposureDefinition", group: "model", value: "SUM_ELIGIBLE_ACTIVE_CASH_LOAN_PRINCIPAL_OUTSTANDING_PER_CUSTOMER", provenance: "DEMO_ASSUMPTION", description: "Demo exposure: principal outstanding of eligible active cash loans, once per customer, max DPD across loans." },
  { key: "model.bucketMethod", group: "model", value: { method: "DECILE_AT_DAILY_SNAPSHOT", tieHandling: "IDENTICAL_ERA_SAME_BUCKET_LOWER", fewerThanTenDistinct: "EMPTY_BUCKETS_ALLOWED" }, provenance: "DEMO_ASSUMPTION", description: "Action buckets are ten ascending ERA groups computed once per daily snapshot. Chart averages in the deck are not boundaries." },
  { key: "model.rescorePolicy", group: "model", value: "DAILY_SNAPSHOT_INTRADAY_INVALIDATION_ONLY", provenance: "DEMO_ASSUMPTION", description: "Intraday payment/contact events invalidate tasks immediately; rescoring/rebucketing happens at the next daily run." },

  // Economics (source draft inputs)
  { key: "economics.unitCosts", group: "economics", value: { sms: { cost: "0.031", unit: "per SMS" }, ivr: { cost: "0.20", unit: "per IVR attempt" }, agent: { cost: "1.75", unit: "per customer-day" } }, provenance: "SOURCE_BASED", description: "Draft unit costs from the deck. Agent cost derives from 3,076 AZN/month ÷ 22 days ÷ 80 contacts." },
  { key: "economics.upliftScenarios", group: "economics", value: { sms: { conservative: "0.001", base: "0.003", upside: "0.005" }, ivr: { conservative: "0.005", base: "0.01", upside: "0.025" }, agent: { conservative: "0.025", base: "0.05", upside: "0.075" } }, provenance: "SOURCE_BASED", description: "Scenario uplift assumptions (relative ERA reduction). Not measured causal benefit." },
  { key: "economics.channels", group: "economics", value: { sms: true, call: true, ivr: false, email: false }, provenance: "SOURCE_BASED", description: "Phase 1 capability: SMS and structured calls enabled; IVR/email unavailable." },

  // Capacity (historical/planning inputs)
  { key: "capacity.planning", group: "capacity", value: { agents: 6, regularAgents: 4, seniorAgents: 2, successfulContactsPerAgentDay: 80, historicalAttemptsPerAgentDay: 219, historicalWorkedCustomersPerAgentDay: 107, historicalReachedPerAgentDay: 82, historicalRpcRate: "0.76" }, provenance: "SOURCE_BASED", description: "6 agents × 80 successful contacts = 480 successful contacts/day is a planning scenario, not an attempt count or target." },
  { key: "capacity.operational", group: "capacity", value: { workingHoursStart: "09:00", workingHoursEnd: "18:00", avgHandleSeconds: 240, avgAcwSeconds: 60, reserveCapacityPct: 10, callbackReservePct: 15 }, provenance: "DEMO_ASSUMPTION", description: "Operational capacity assumptions used by the economics/capacity screen." },

  // Operational controls
  { key: "outbound.killSwitch", group: "outbound", value: false, provenance: "DEMO_ASSUMPTION", description: "Emergency stop for all outbound execution.", editableRoles: ["COLLECTIONS_HEAD", "TEAM_LEAD", "ADMIN", "INTEGRATION_OPERATOR"] },
  { key: "outbound.pausedChannels", group: "outbound", value: [], provenance: "DEMO_ASSUMPTION", description: "Channels paused by an authorized operator (VOICE, SMS).", editableRoles: ["COLLECTIONS_HEAD", "TEAM_LEAD", "ADMIN", "INTEGRATION_OPERATOR"] },
  { key: "outbound.pausedCampaigns", group: "outbound", value: [], provenance: "DEMO_ASSUMPTION", description: "Campaign codes paused by a supervisor.", editableRoles: ["COLLECTIONS_HEAD", "TEAM_LEAD", "ADMIN"] },

  // Clock
  { key: "clock.demoBusinessDate", group: "clock", value: "2026-10-27", provenance: "DEMO_ASSUMPTION", description: "Seeded demo business date (Asia/Baku)." },
  { key: "clock.demoOffsetMs", group: "clock", value: 0, provenance: "DEMO_ASSUMPTION", description: "Offset applied to the host clock so the seeded business date is 'today' at seed time.", editableRoles: ADMIN_ONLY },

  // Feature flags
  { key: "flags.realConnectors", group: "flags", value: { coreBanking: false, paymentFeed: false, sms: false, dialer: false, identityProvider: false, biExport: false }, provenance: "DEMO_ASSUMPTION", description: "Real connectors are off by default; enabling one requires configuration and bank approval inside the product." },
  { key: "flags.aiFeatures", group: "flags", value: { summaries: false, policySearch: false }, provenance: "DEMO_ASSUMPTION", description: "Optional reviewed AI features are deferred (P2) and default off. No customer data leaves the system." },
];
