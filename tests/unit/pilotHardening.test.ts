import { describe, expect, it, beforeEach } from "vitest";
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/server/auth/rateLimit";
import { promiseHorizonCheck, type PromisePolicy } from "@/server/modules/promises/promiseService";
import { computeNextAction } from "@/server/modules/interactions/outcomeService";
import { outcomeSchema, validateOutcomeBusinessRules } from "@/server/modules/interactions/outcomeSchema";
import { DEMO_CONTACT_POLICY } from "@/server/modules/contactPolicy/types";
import { normalizePhoneTerm } from "@/server/modules/customers/customerService";
import { smsInfo } from "@/server/modules/templates/templateService";
import { byCustomerWhere, customerWhere, scopeAllows, scopeIsUnscoped, type CustomerScope } from "@/server/auth/scope";
import { applyBranchScope } from "@/server/modules/analytics/analyticsService";
import { MockDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { readControlState, EMPTY_CONTROL_STATE } from "@/server/modules/dialer/contract";
import { dictionaries, t } from "@/i18n/dictionaries";
import { hasPermission, landingPathForRole } from "@/server/auth/permissions";

const now = new Date("2026-10-29T06:00:00.000Z"); // 10:00 Baku, Thursday
const policy: PromisePolicy = { maxHorizonDays: 30, deadlineCalendarRule: "NEXT_BUSINESS_DAY_GRACE", settlementAllowanceDays: 2, provenance: "test" };
const base = (over: Record<string, unknown>) => outcomeSchema.parse({ idempotencyKey: "unit-00000001", identityStatus: "RPC_VERIFIED", businessOutcome: "NO_COMMITMENT", nonPaymentReason: "NOT_STATED", returnReady: true, ...over });
const customer = (overdue: string) => ({ displayName: "Test", overdueDueNow: overdue, balancesAsOf: now, loans: [{ id: "L1", coreLoanId: "CORE-L1", totalOverdue: overdue }] });

describe("pilot hardening: sign-in rate limiting", () => {
  beforeEach(() => resetLoginRateLimit());
  it("locks a username after repeated failures and an IP after more, with a retry hint", () => {
    for (let i = 0; i < 8; i++) recordLoginFailure({ ip: "10.0.0.1", username: "agent.a" }, now.getTime());
    expect(() => checkLoginRateLimit({ ip: "10.0.0.1", username: "agent.a" }, now.getTime())).toThrowError(/Too many sign-in attempts/);
    expect(() => checkLoginRateLimit({ ip: "10.0.0.1", username: "agent.b" }, now.getTime())).not.toThrow();
    for (let i = 0; i < 30; i++) recordLoginFailure({ ip: "10.0.0.2", username: `u${i}` }, now.getTime());
    expect(() => checkLoginRateLimit({ ip: "10.0.0.2", username: "fresh" }, now.getTime())).toThrowError(/Too many/);
    // The window slides: after 15 minutes the same IP is allowed again.
    expect(() => checkLoginRateLimit({ ip: "10.0.0.2", username: "fresh" }, now.getTime() + 16 * 60_000)).not.toThrow();
  });
});

describe("pilot hardening: promise horizon and exception path", () => {
  it("accepts dates inside the horizon and refuses later or past dates", () => {
    expect(promiseHorizonCheck("2026-11-28", now, policy).ok).toBe(true);
    expect(promiseHorizonCheck("2026-11-29", now, policy)).toMatchObject({ ok: false, maxDate: "2026-11-28", daysAhead: 31 });
    expect(promiseHorizonCheck("2026-10-28", now, policy).ok).toBe(false);
  });
  it("a promise beyond the horizon is refused with a pointer to the exception; an exception inside the horizon is refused", () => {
    const ptp = { amount: "100.00", deadlineDate: "2026-12-15", coveredLoanIds: ["L1"], customerConfirmed: true };
    const promise = computeNextAction(base({ businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("100.00"), promisePolicy: policy });
    expect(promise.errors.join(" ")).toMatch(/outside the promise policy/);
    const exception = computeNextAction(base({ businessOutcome: "PTP_EXCEPTION_PROPOSED", nonPaymentReason: "SALARY_TIMING", ptp }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("100.00"), promisePolicy: policy });
    expect(exception.errors).toEqual([]);
    expect(exception.nextAction).toBe("COOLDOWN");
    expect(exception.referral).toMatch(/approval/);
    expect(exception.factualSummary).toContain("promise-date exception was sent for approval");
    const inside = computeNextAction(base({ businessOutcome: "PTP_EXCEPTION_PROPOSED", nonPaymentReason: "SALARY_TIMING", ptp: { ...ptp, deadlineDate: "2026-11-05" } }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("100.00"), promisePolicy: policy });
    expect(inside.errors.join(" ")).toMatch(/within the promise policy/);
  });
});

describe("pilot hardening: overdue cleared during the call and death reports", () => {
  it("'Overdue cleared' needs a zero overdue on the fresh snapshot and creates no retry", () => {
    const blocked = computeNextAction(base({ businessOutcome: "DELINQUENCY_CLOSED", nonPaymentReason: null }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("55.10") });
    expect(blocked.errors.join(" ")).toMatch(/still 55.10 AZN/);
    const ok = computeNextAction(base({ businessOutcome: "DELINQUENCY_CLOSED", nonPaymentReason: null }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("0.00") });
    expect(ok.errors).toEqual([]);
    expect(ok.factualSummary).toContain("Gecikmə bağlanıb");
    expect(ok.digitalReminders).toMatch(/None/);
  });
  it("a death report requires who reported it and stays a report, not a confirmation", () => {
    const missing = validateOutcomeBusinessRules(base({ identityStatus: "THIRD_PARTY", businessOutcome: "SPECIAL_REFERRAL", nonPaymentReason: null, note: "Spouse called", support: { type: "DECEASED_LEGAL", reason: "Spouse informed us" } }));
    expect(missing.join(" ")).toMatch(/who reported the death/);
    const r = computeNextAction(base({ identityStatus: "THIRD_PARTY", businessOutcome: "SPECIAL_REFERRAL", nonPaymentReason: null, note: "Spouse called", support: { type: "DECEASED_LEGAL", reason: "Spouse informed us", reporterRelation: "SPOUSE" } }), { now, policy: DEMO_CONTACT_POLICY, technicalResult: "ANSWERED", customer: customer("100.00") });
    expect(r.errors).toEqual([]);
    expect(r.nextAction).toBe("SPECIAL_REFERRAL");
    expect(r.factualSummary).toContain("reported by spouse (reported, not confirmed)");
  });
});

describe("pilot hardening: scoped search and authorization scope helpers", () => {
  it("normalizes telephone search terms", () => {
    expect(normalizePhoneTerm("+994 50 100 00 01")).toBe("994501000001");
    expect(normalizePhoneTerm("050-100-00-01")).toBe("994501000001");
    expect(normalizePhoneTerm("00994501000001")).toBe("994501000001");
    expect(normalizePhoneTerm("Demo customer")).toBeNull();
  });
  it("scope kinds produce matching where-clauses and point checks", () => {
    const all: CustomerScope = { kind: "ALL", branches: [], customerIds: [], historyDays: 14, evaluatedAt: now };
    const branches: CustomerScope = { ...all, kind: "BRANCHES", branches: ["Ganja"] };
    const mine: CustomerScope = { ...all, kind: "CUSTOMERS", customerIds: ["C-1"] };
    const none: CustomerScope = { ...all, kind: "NONE" };
    expect(customerWhere(all)).toEqual({});
    expect(customerWhere(branches)).toEqual({ branch: { in: ["Ganja"] } });
    expect(byCustomerWhere(mine)).toEqual({ customerId: { in: ["C-1"] } });
    expect(byCustomerWhere(none)).toEqual({ customerId: { in: [] } });
    expect(scopeIsUnscoped(branches)).toBe(true);
    expect(scopeIsUnscoped(mine)).toBe(false);
    expect(scopeAllows(mine, { id: "C-1" })).toBe(true);
    expect(scopeAllows(mine, { id: "C-2" })).toBe(false);
    expect(scopeAllows(branches, { id: "C-9", branch: "Baku-Nasimi" })).toBe(false);
  });
  it("analytics branch scope narrows exports and refuses foreign branches", () => {
    expect(applyBranchScope({ branchScopes: [] }, { branch: "Ganja" })).toEqual({ branch: "Ganja" });
    expect(applyBranchScope({ branchScopes: ["Ganja", "Sumgayit"] }, {})).toEqual({ branches: ["Ganja", "Sumgayit"] });
    expect(() => applyBranchScope({ branchScopes: ["Ganja"] }, { branch: "Baku-Nasimi" })).toThrowError(/outside your scope/);
  });
  it("arrangement and exception permissions follow the maker/reviewer/approver matrix", () => {
    expect(hasPermission("TEAM_LEAD", "arrangement.write")).toBe(true);
    expect(hasPermission("TEAM_LEAD", "ptp-exception.decide")).toBe(true);
    expect(hasPermission("AGENT", "ptp-exception.decide")).toBe(false);
    expect(hasPermission("AGENT", "diagnostics.read")).toBe(false);
    expect(hasPermission("INTEGRATION_OPERATOR", "diagnostics.read")).toBe(true);
    expect(landingPathForRole("TEAM_LEAD")).toBe("/home");
    expect(landingPathForRole("AGENT")).toBe("/agent");
  });
});

describe("pilot hardening: SMS segments for Azerbaijani text", () => {
  it("Azerbaijani letters force UCS-2 with 70-character segments", () => {
    const az = smsInfo("ATB: Əliyev, 499.24 AZN gecikmiş ödənişiniz var. Şəhər filialına müraciət edin və ya mobil tətbiqdən ödəyin.");
    expect(az.encoding).toBe("UCS-2");
    expect(az.segments).toBe(2);
    const en = smsInfo("ATB: your installment of 499.24 AZN is unpaid. Please pay via ATB mobile.");
    expect(en.encoding).toBe("GSM-7");
    expect(en.segments).toBe(1);
  });
});

describe("pilot hardening: mock provider controls, injected clock and persisted state", () => {
  it("END is rejected for a 'reject-end' call, unknown interactions are rejected, mute is confirmed and survives hydrate", async () => {
    let clock = new Date("2026-10-29T06:00:00.000Z");
    const adapter = new MockDialerAdapter(() => clock);
    adapter.hydrate({ interactions: [{ providerInteractionRef: "mock-call-res-ok", correlationId: "res-ok", state: "CONNECTED", technicalResult: "ANSWERED", startedAt: clock.toISOString(), answeredAt: clock.toISOString(), endedAt: null, agentRef: "mock-agent-1042" }, { providerInteractionRef: "mock-call-res-reject-end", correlationId: "res-reject-end", state: "CONNECTED", technicalResult: "ANSWERED", startedAt: clock.toISOString(), answeredAt: clock.toISOString(), endedAt: null, agentRef: "mock-agent-1043" }], agentStates: [] });
    const mute = await adapter.requestCallControl({ idempotencyKey: "k1", correlationId: "res-ok", providerInteractionRef: "mock-call-res-ok", action: "MUTE", agentRef: "mock-agent-1042" });
    expect(mute.status).toBe("CONFIRMED");
    expect((await adapter.getInteraction("mock-call-res-ok")).muted).toBe(true);
    const rejected = await adapter.requestCallControl({ idempotencyKey: "k2", correlationId: "res-reject-end", providerInteractionRef: "mock-call-res-reject-end", action: "END", agentRef: "mock-agent-1043" });
    expect(rejected.status).toBe("REJECTED");
    expect((await adapter.getInteraction("mock-call-res-reject-end")).state).toBe("CONNECTED");
    const unknown = await adapter.requestCallControl({ idempotencyKey: "k3", correlationId: "res-x", providerInteractionRef: "mock-call-nope", action: "HOLD", agentRef: "a" });
    expect(unknown.status).toBe("REJECTED");
    clock = new Date(clock.getTime() + 61_000);
    const end = await adapter.requestCallControl({ idempotencyKey: "k4", correlationId: "res-ok", providerInteractionRef: "mock-call-res-ok", action: "END", agentRef: "mock-agent-1042" });
    expect(end.status).toBe("CONFIRMED");
    expect((await adapter.getInteraction("mock-call-res-ok")).endedAt).toBe(clock.toISOString()); // injected clock, not wall clock
    // Persisted provider view round-trips into a fresh adapter (worker restart).
    const restarted = new MockDialerAdapter(() => clock);
    restarted.hydrate(adapter.snapshot());
    expect((await restarted.getInteraction("mock-call-res-reject-end")).state).toBe("CONNECTED");
    expect((await restarted.getInteraction("mock-call-res-ok")).state).toBe("ENDED");
  });
  it("control state is read defensively from persisted JSON", () => {
    expect(readControlState(null)).toEqual(EMPTY_CONTROL_STATE);
    expect(readControlState({ muted: true, pending: [{ action: "HOLD", key: "k", requestedAt: "2026-10-29T06:00:00.000Z" }] })).toMatchObject({ muted: true, held: false, pending: [{ action: "HOLD" }] });
  });
});

describe("pilot hardening: Azerbaijani-first dictionaries", () => {
  it("every agent outcome, identity and state has an Azerbaijani label and placeholders are filled", () => {
    const az = dictionaries.az.agent!;
    for (const k of ["PTP", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "NO_COMMITMENT", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "SPECIAL_REFERRAL", "NO_CONVERSATION", "DELINQUENCY_CLOSED", "PTP_EXCEPTION_PROPOSED"]) expect((az.outcomes as Record<string, string>)[k], k).toBeTruthy();
    for (const k of ["READY", "TALKING", "RESERVED", "DIALING", "ACW", "NOT_READY", "BREAK", "OFFLINE", "CONNECTION_PROBLEM"]) expect((az.states as Record<string, string>)[k], k).toBeTruthy();
    expect(t("az", "agent.outcomes.DELINQUENCY_CLOSED")).toBe("Gecikmə bağlanıb");
    expect(t("az", "agent.eligibility.dataCurrent")).toBe("Məlumat aktualdır");
    expect(t("az", "agent.eligibility.contactAllowed")).toBe("Əlaqəyə icazə var");
    expect(t("ru", "agent.form.horizon", { days: 30, max: "28 Nov 2026" })).toContain("30"); // falls back to English with placeholders filled
    expect(t("en", "missing.key")).toBe("missing.key");
  });
});
