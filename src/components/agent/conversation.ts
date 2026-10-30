import type { OutcomeDraft } from "@/components/agent/types";

/**
 * Pure conversation model shared by the script, the structured answers and the bottom summary. There is ONE draft
 * (persisted on the server and restored on reload); everything shown is derived from it, so the confirmation script,
 * the promise fields and the preview always show the same amount and date.
 */
export type StageKey = "identity" | "discussion" | "outcome";

export const STAGE_STEPS: Record<StageKey, string[]> = {
  identity: ["verify"],
  discussion: ["explain", "reason"],
  outcome: ["agree", "confirm", "close"],
};

export const PROMISE_OUTCOMES = ["PTP", "PARTIAL_COMMITMENT", "PTP_EXCEPTION_PROPOSED"];
export const RPC_OUTCOMES = ["PTP", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "NO_COMMITMENT", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "SPECIAL_REFERRAL"] as const;
export const THIRD_PARTY_OUTCOMES = ["NO_CONVERSATION", "SPECIAL_REFERRAL"] as const;
/** Outcomes for which the customer's reason is required (mirrors the server rule). */
export const REASON_REQUIRED = ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED", "PTP_EXCEPTION_PROPOSED"];

export function isPromise(outcome: string | undefined | null) {
  return !!outcome && PROMISE_OUTCOMES.includes(outcome);
}

/** Outcomes the agent may choose for the identity status. Identity is never inferred; it is the agent's choice. */
export function allowedOutcomes(identity: string | undefined, overdueCleared = false): string[] {
  if (identity === "RPC_VERIFIED") return [...(overdueCleared ? ["DELINQUENCY_CLOSED"] : []), ...RPC_OUTCOMES, "PTP_EXCEPTION_PROPOSED"];
  if (identity === "THIRD_PARTY") return [...THIRD_PARTY_OUTCOMES];
  if (identity) return ["NO_CONVERSATION"];
  return [];
}

export interface StageStatus {
  identityDone: boolean;
  discussionApplies: boolean;
  discussionDone: boolean;
  outcomeDone: boolean;
  current: StageKey;
}

/** Stage progress derived from the draft (so a reload or a return to the call opens the same stage). */
export function stageStatus(draft: OutcomeDraft, discussionSkipped = false): StageStatus {
  const identityDone = !!draft.identityStatus && (draft.identityStatus !== "WRONG_NUMBER" || !!draft.wrongNumber?.contactPointId);
  const discussionApplies = draft.identityStatus === "RPC_VERIFIED";
  const discussionDone = !discussionApplies || !!draft.nonPaymentReason || discussionSkipped || !!draft.businessOutcome;
  const outcomeDone = !!draft.businessOutcome;
  const current: StageKey = !identityDone ? "identity" : discussionApplies && !discussionDone ? "discussion" : "outcome";
  return { identityDone, discussionApplies, discussionDone, outcomeDone, current };
}

/** Script steps for a stage; the confirmation passage only appears once a promise is being agreed. */
export function scriptStepsFor(stage: StageKey, draft: OutcomeDraft): string[] {
  if (stage !== "outcome") return STAGE_STEPS[stage];
  return isPromise(draft.businessOutcome) ? ["agree", "confirm", "close"] : draft.businessOutcome ? ["agree", "close"] : ["agree"];
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Date shortcuts offered only when inside the configured promise horizon. */
export function dateShortcuts(todayIso: string, maxDate: string | null | undefined): { key: "today" | "plus3" | "plus7"; date: string }[] {
  const all = [
    { key: "today" as const, date: todayIso },
    { key: "plus3" as const, date: isoAddDays(todayIso, 3) },
    { key: "plus7" as const, date: isoAddDays(todayIso, 7) },
  ];
  return maxDate ? all.filter((s) => s.date <= maxDate) : all;
}

export interface AmountPreset {
  key: "overdue" | "installment";
  amount: string;
}

export function amountPresets(overdueTotal: string | null, nextInstallment: string | null): AmountPreset[] {
  const out: AmountPreset[] = [];
  if (overdueTotal && Number(overdueTotal) > 0) out.push({ key: "overdue", amount: Number(overdueTotal).toFixed(2) });
  if (nextInstallment && Number(nextInstallment) > 0 && Number(nextInstallment).toFixed(2) !== out[0]?.amount) out.push({ key: "installment", amount: Number(nextInstallment).toFixed(2) });
  return out;
}

const same = (a: string | undefined | null, b: string) => !!a && a !== "" && Number(a).toFixed(2) === b;

/** Which amount choice the draft represents: a preset, a custom value (restored visibly), or nothing yet. */
export function amountChoice(draft: OutcomeDraft, presets: AmountPreset[], customOpened: boolean): "overdue" | "installment" | "custom" | null {
  const amount = draft.ptp?.amount;
  if (customOpened) return "custom";
  if (!amount) return null;
  const preset = presets.find((p) => same(amount, p.amount));
  return preset ? preset.key : "custom";
}

/** Callback time shortcuts in Baku time: tomorrow 10:00, tomorrow 18:00 and two hours from now. */
export function callbackShortcuts(nowMs: number, bakuIso: (at: Date) => string, fromBakuLocal: (local: string) => string | null): { key: "tomorrow10" | "tomorrow18" | "plus2h"; dueAt: string }[] {
  const tomorrow = bakuIso(new Date(nowMs + 86_400_000));
  // Rounded to the minute so the choice stays recognisable after a reload.
  const plus2h = new Date(Math.round((nowMs + 2 * 3_600_000) / 60_000) * 60_000).toISOString();
  return [
    { key: "tomorrow10", dueAt: fromBakuLocal(`${tomorrow}T10:00`) ?? "" },
    { key: "tomorrow18", dueAt: fromBakuLocal(`${tomorrow}T18:00`) ?? "" },
    { key: "plus2h", dueAt: plus2h },
  ];
}

/** Which callback choice the draft represents; a stored time that matches no shortcut is shown as the custom time. */
export function callbackChoice(draft: OutcomeDraft, shortcuts: { key: string; dueAt: string }[], customOpened: boolean): string | null {
  const dueAt = draft.callback?.dueAt;
  if (customOpened) return "custom";
  if (!dueAt) return null;
  const ms = Date.parse(dueAt);
  return shortcuts.find((s) => s.key !== "plus2h" && Date.parse(s.dueAt) === ms)?.key ?? "custom";
}

export function dateChoice(draft: OutcomeDraft, shortcuts: { key: string; date: string }[], customOpened: boolean): string | null {
  const date = draft.ptp?.deadlineDate;
  if (customOpened) return "custom";
  if (!date) return null;
  return shortcuts.find((s) => s.date === date)?.key ?? "custom";
}

/** Partial-promise facts for the selected loans: covered overdue, the promised amount and the remaining arrears. */
export function promiseCoverage(draft: OutcomeDraft, loans: { id: string; totalOverdue: string }[]): { covered: number; amount: number; partial: boolean; rest: number } | null {
  if (!draft.ptp || !draft.ptp.amount) return null;
  const covered = loans.filter((l) => draft.ptp!.coveredLoanIds.includes(l.id)).reduce((s, l) => s + Number(l.totalOverdue), 0);
  const amount = Number(draft.ptp.amount);
  if (!Number.isFinite(amount)) return null;
  return { covered, amount, partial: covered > 0 && amount < covered - 0.004, rest: Math.max(0, covered - amount) };
}

/**
 * Applies a change to the promise fields. Explicit agreement covers one amount, date and loan set: changing any of
 * them clears the agreement so the customer has to confirm again. Agreement is never set here.
 */
export function updatePromise(draft: OutcomeDraft, patch: Partial<NonNullable<OutcomeDraft["ptp"]>>, defaultLoans: string[]): OutcomeDraft {
  const base = draft.ptp ?? { amount: "", deadlineDate: "", coveredLoanIds: defaultLoans, customerConfirmed: false };
  const changedTerms = (patch.amount !== undefined && patch.amount !== base.amount) || (patch.deadlineDate !== undefined && patch.deadlineDate !== base.deadlineDate) || (patch.coveredLoanIds !== undefined && patch.coveredLoanIds.join(",") !== base.coveredLoanIds.join(","));
  const next = { ...base, ...patch };
  if (changedTerms && patch.customerConfirmed === undefined) next.customerConfirmed = false;
  return { ...draft, ptp: next };
}

/** Values bound into the script. Missing promise values stay null so the script shows a visible placeholder. */
export function scriptValues(draft: OutcomeDraft, formatDate: (iso: string) => string): { promiseAmount: string | null; promiseDate: string | null } {
  const p = isPromise(draft.businessOutcome) ? draft.ptp : null;
  return {
    promiseAmount: p?.amount && Number(p.amount) > 0 ? Number(p.amount).toFixed(2) : null,
    promiseDate: p?.deadlineDate ? formatDate(p.deadlineDate) : null,
  };
}

/** Splits a script text into literal and variable segments (variables rendered as highlighted values). */
export function bindScript(text: string, vars: Record<string, string | null | undefined>): { text: string; variable?: string; missing?: boolean }[] {
  const out: { text: string; variable?: string; missing?: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    const v = vars[m[1]];
    out.push({ text: v ?? m[1], variable: m[1], missing: v === null || v === undefined || v === "" });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Fields that belong to one outcome; kept aside (not submitted) when the agent switches outcome, restored on return. */
export const OUTCOME_FIELDS = ["ptp", "callback", "paidClaim", "dispute", "support", "customerStatement"] as const;
export type OutcomeFieldKey = (typeof OUTCOME_FIELDS)[number];

export function fieldsFor(outcome: string | undefined): OutcomeFieldKey[] {
  switch (outcome) {
    case "PTP":
    case "PARTIAL_COMMITMENT":
    case "PTP_EXCEPTION_PROPOSED":
      return ["ptp"];
    case "CALLBACK_REQUESTED":
      return ["callback", "customerStatement"];
    case "ALREADY_PAID_CLAIM":
      return ["paidClaim"];
    case "DISPUTE":
      return ["dispute"];
    case "SUPPORT_NEEDED":
    case "SPECIAL_REFERRAL":
      return ["support"];
    case "NO_COMMITMENT":
    case "REFUSED":
      return ["customerStatement"];
    default:
      return [];
  }
}

export type Stash = { rpc?: Partial<OutcomeDraft>; outcomes: Record<string, Partial<OutcomeDraft>> };

/**
 * Changes the outcome, keeping the previous outcome's fields aside and restoring them when the agent comes back
 * (revisiting an answer does not lose later draft data). Fields of other outcomes are never submitted.
 */
export function switchOutcome(draft: OutcomeDraft, outcome: string, stash: Stash): OutcomeDraft {
  const prev = draft.businessOutcome;
  const sameFamily = isPromise(prev) && isPromise(outcome);
  if (prev && !sameFamily) {
    const keep: Partial<OutcomeDraft> = {};
    for (const f of fieldsFor(prev)) if (draft[f] !== undefined && draft[f] !== null) (keep as Record<string, unknown>)[f] = draft[f];
    stash.outcomes[prev] = keep;
  }
  const next: OutcomeDraft = { ...draft, businessOutcome: outcome };
  if (!sameFamily) {
    for (const f of OUTCOME_FIELDS) if (!fieldsFor(outcome).includes(f)) (next as Record<string, unknown>)[f] = null;
    const restore = stash.outcomes[outcome];
    if (restore) for (const [k, v] of Object.entries(restore)) if (!(next as Record<string, unknown>)[k]) (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

/**
 * Changes who is speaking. Disclosure rules apply: only a verified borrower keeps reason, promise and other debt
 * answers; they are set aside (not submitted) and restored if the agent corrects the identity back to verified.
 */
export function switchIdentity(draft: OutcomeDraft, identity: string, stash: Stash, overdueCleared = false): OutcomeDraft {
  const wasRpc = draft.identityStatus === "RPC_VERIFIED";
  let next: OutcomeDraft = { ...draft, identityStatus: identity };
  if (wasRpc && identity !== "RPC_VERIFIED") {
    stash.rpc = { nonPaymentReason: draft.nonPaymentReason, businessOutcome: draft.businessOutcome, ptp: draft.ptp, callback: draft.callback, paidClaim: draft.paidClaim, dispute: draft.dispute, support: draft.support, customerStatement: draft.customerStatement, secondaryFlags: draft.secondaryFlags };
    next = { ...next, nonPaymentReason: null, ptp: null, callback: null, paidClaim: null, dispute: null, customerStatement: null, secondaryFlags: [] };
  }
  if (!wasRpc && identity === "RPC_VERIFIED" && stash.rpc) {
    next = { ...next, ...stash.rpc };
    stash.rpc = undefined;
  }
  if (identity !== "WRONG_NUMBER") next.wrongNumber = null;
  const allowed = allowedOutcomes(identity, overdueCleared);
  if (!allowed.includes(next.businessOutcome ?? "")) {
    // Exactly one possible outcome (no verified contact) is filled in; otherwise nothing is preselected.
    next.businessOutcome = allowed.length === 1 ? allowed[0] : undefined;
    if (next.businessOutcome !== "SPECIAL_REFERRAL" && next.businessOutcome !== "SUPPORT_NEEDED") next.support = null;
  }
  return next;
}
