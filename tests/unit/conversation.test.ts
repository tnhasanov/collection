import { describe, expect, it } from "vitest";
import {
  allowedOutcomes,
  amountChoice,
  amountPresets,
  bindScript,
  callbackChoice,
  callbackShortcuts,
  dateChoice,
  dateShortcuts,
  promiseCoverage,
  scriptValues,
  stageStatus,
  switchIdentity,
  switchOutcome,
  updatePromise,
  type Stash,
} from "@/components/agent/conversation";
import type { OutcomeDraft } from "@/components/agent/types";
import { bakuTodayIso, fmtDate, fromBakuLocalInput } from "@/lib/format";
import { at, errorText } from "@/i18n/agentText";

const CONFIRM = "{{customerName}}, siz {{promiseDate}} tarixinədək {{promiseAmount}} AZN ödəməyə razısınız?";
const fmtAz = (iso: string) => fmtDate(iso, "az");
const promiseDraft = (ptp: Partial<NonNullable<OutcomeDraft["ptp"]>> = {}): OutcomeDraft => ({ identityStatus: "RPC_VERIFIED", businessOutcome: "PTP", nonPaymentReason: "SALARY_TIMING", ptp: { amount: "", deadlineDate: "", coveredLoanIds: ["L1"], customerConfirmed: false, ...ptp } });

describe("one draft for the script, the fields and the summary", () => {
  it("the confirmation script shows exactly the amount and date in the draft", () => {
    const draft = promiseDraft({ amount: "137.5", deadlineDate: "2026-11-03" });
    const v = scriptValues(draft, fmtAz);
    const text = bindScript(CONFIRM, { customerName: "Aysel", ...v }).map((s) => s.text).join("");
    expect(text).toBe("Aysel, siz 03.11.2026 tarixinədək 137.50 AZN ödəməyə razısınız?");
  });

  it("missing promise values stay visible placeholders instead of a default amount or date", () => {
    const seg = bindScript(CONFIRM, { customerName: "Aysel", ...scriptValues(promiseDraft(), fmtAz) });
    expect(seg.filter((s) => s.missing).map((s) => s.variable)).toEqual(["promiseDate", "promiseAmount"]);
  });

  it("a custom amount and date restore as the custom choice after a reload", () => {
    const presets = amountPresets("300.00", "120.00");
    const shortcuts = dateShortcuts("2026-10-30", "2026-11-13");
    const draft = promiseDraft({ amount: "175.25", deadlineDate: "2026-11-10" });
    expect(amountChoice(draft, presets, false)).toBe("custom");
    expect(dateChoice(draft, shortcuts, false)).toBe("custom");
    // A preset value maps back to its preset, whatever its string form.
    expect(amountChoice(promiseDraft({ amount: "300" }), presets, false)).toBe("overdue");
    expect(dateChoice(promiseDraft({ deadlineDate: "2026-11-02" }), shortcuts, false)).toBe("plus3");
    expect(amountChoice(promiseDraft(), presets, false)).toBeNull();
  });

  it("date shortcuts are only offered inside the promise horizon", () => {
    expect(dateShortcuts("2026-10-30", "2026-11-03").map((s) => s.key)).toEqual(["today", "plus3"]);
    expect(dateShortcuts("2026-10-30", "2026-10-30").map((s) => s.key)).toEqual(["today"]);
  });

  it("changing amount, date or loans after agreement clears the agreement; nothing sets it implicitly", () => {
    const agreed = updatePromise(promiseDraft({ amount: "100", deadlineDate: "2026-11-02" }), { customerConfirmed: true }, ["L1"]);
    expect(agreed.ptp?.customerConfirmed).toBe(true);
    expect(updatePromise(agreed, { amount: "120" }, ["L1"]).ptp?.customerConfirmed).toBe(false);
    expect(updatePromise(agreed, { deadlineDate: "2026-11-03" }, ["L1"]).ptp?.customerConfirmed).toBe(false);
    expect(updatePromise(agreed, { coveredLoanIds: ["L1", "L2"] }, ["L1"]).ptp?.customerConfirmed).toBe(false);
    expect(updatePromise(agreed, { amount: "100" }, ["L1"]).ptp?.customerConfirmed).toBe(true);
    expect(updatePromise({ identityStatus: "RPC_VERIFIED", businessOutcome: "PTP" }, { amount: "50" }, ["L1"]).ptp?.customerConfirmed).toBe(false);
  });

  it("partial promises show what stays overdue", () => {
    const loans = [{ id: "L1", totalOverdue: "300.00" }, { id: "L2", totalOverdue: "80.00" }];
    expect(promiseCoverage(promiseDraft({ amount: "200", coveredLoanIds: ["L1"] }), loans)).toEqual({ covered: 300, amount: 200, partial: true, rest: 100 });
    expect(promiseCoverage(promiseDraft({ amount: "380", coveredLoanIds: ["L1", "L2"] }), loans)?.partial).toBe(false);
  });

  it("callback shortcuts are Baku times; a stored time that matches none restores as the custom time", () => {
    const now = Date.parse("2026-10-30T08:15:00Z"); // 12:15 Baku
    const s = callbackShortcuts(now, (d) => bakuTodayIso(d.toISOString()), fromBakuLocalInput);
    expect(s[0].dueAt).toBe("2026-10-31T06:00:00.000Z"); // tomorrow 10:00 Baku
    expect(s[1].dueAt).toBe("2026-10-31T14:00:00.000Z");
    expect(callbackChoice({ callback: { dueAt: s[1].dueAt, customerRequested: true, ownerMode: "ME" } }, s, false)).toBe("tomorrow18");
    expect(callbackChoice({ callback: { dueAt: "2026-11-02T09:30:00.000Z", customerRequested: true, ownerMode: "ME" } }, s, false)).toBe("custom");
    expect(callbackChoice({}, s, false)).toBeNull();
  });
});

describe("identity decides what may be discussed", () => {
  it("nothing is preselected and only identity-appropriate outcomes are offered", () => {
    expect(allowedOutcomes(undefined)).toEqual([]);
    expect(allowedOutcomes("THIRD_PARTY")).toEqual(["NO_CONVERSATION", "SPECIAL_REFERRAL"]);
    expect(allowedOutcomes("WRONG_PERSON")).toEqual(["NO_CONVERSATION"]);
    expect(allowedOutcomes("RPC_VERIFIED")).toContain("PTP");
    expect(allowedOutcomes("RPC_VERIFIED")).not.toContain("DELINQUENCY_CLOSED");
    expect(allowedOutcomes("RPC_VERIFIED", true)[0]).toBe("DELINQUENCY_CLOSED");
  });

  it("leaving verified identity sets debt answers aside and restores them on return", () => {
    const stash: Stash = { outcomes: {} };
    const verified = promiseDraft({ amount: "90", deadlineDate: "2026-11-01", customerConfirmed: true });
    const third = switchIdentity(verified, "THIRD_PARTY", stash);
    expect(third.ptp).toBeNull();
    expect(third.nonPaymentReason).toBeNull();
    expect(third.businessOutcome).toBeUndefined(); // two options: the agent chooses
    const wrongPerson = switchIdentity(third, "WRONG_PERSON", stash);
    expect(wrongPerson.businessOutcome).toBe("NO_CONVERSATION"); // the only possible outcome
    const back = switchIdentity(wrongPerson, "RPC_VERIFIED", stash);
    expect(back.businessOutcome).toBe("PTP");
    expect(back.ptp).toEqual(verified.ptp);
    expect(back.nonPaymentReason).toBe("SALARY_TIMING");
  });

  it("switching outcome keeps the previous outcome's fields aside instead of submitting them", () => {
    const stash: Stash = { outcomes: {} };
    const withPromise = promiseDraft({ amount: "90", deadlineDate: "2026-11-01" });
    const cb = switchOutcome(withPromise, "CALLBACK_REQUESTED", stash);
    expect(cb.ptp).toBeNull();
    const again = switchOutcome({ ...cb, callback: { dueAt: "2026-10-31T06:00:00.000Z", customerRequested: true, ownerMode: "ME" } }, "PTP", stash);
    expect(again.ptp?.amount).toBe("90");
    expect(again.callback).toBeNull();
  });

  it("the stage follows from the draft, including an explicitly skipped reason", () => {
    expect(stageStatus({}).current).toBe("identity");
    expect(stageStatus({ identityStatus: "WRONG_NUMBER" }).current).toBe("identity");
    expect(stageStatus({ identityStatus: "RPC_VERIFIED" }).current).toBe("discussion");
    expect(stageStatus({ identityStatus: "RPC_VERIFIED" }, true).current).toBe("outcome");
    expect(stageStatus({ identityStatus: "THIRD_PARTY" }).discussionApplies).toBe(false);
    expect(stageStatus({ identityStatus: "RPC_VERIFIED", nonPaymentReason: "FORGOT" }).current).toBe("outcome");
  });
});

describe("agent-facing language", () => {
  it("errors are shown in Azerbaijani by code", () => {
    expect(errorText("az", { code: "CONFLICT", message: "The call is still active", details: { code: "CALL_ACTIVE" } })).toBe("Zəng hələ davam edir; əvvəlcə zəngi bitirin");
    expect(at("az", "bar.saveNext")).toBe("Yadda saxla və davam et");
    expect(at("ru", "fu.callbacks")).toBe(at("en", "fu.callbacks")); // missing Russian falls back to English
  });
});
