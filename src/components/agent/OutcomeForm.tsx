"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn, fmtDate, bakuTodayIso, toBakuLocalInput, fromBakuLocalInput } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";

/**
 * Guided responses (blueprint §5): Step A who is speaking → Step B customer-stated reason → Step C agreed outcome
 * with conditional fields → independent flags → optional note. Quick-choice cards for frequent answers, nothing
 * preselected, bank facts prefilled as suggestions only, and every customer agreement explicitly confirmed.
 */
const IDENTITY: [string, string, string][] = [
  ["RPC_VERIFIED", "Borrower verified", "approved procedure completed"],
  ["THIRD_PARTY", "Third party", "privacy script, no debt details"],
  ["VERIFICATION_FAILED", "Verification failed / incomplete", "no verified borrower contact"],
  ["WRONG_PERSON", "Wrong person", "number reaches someone else"],
  ["WRONG_NUMBER", "Wrong number", "block this contact point"],
];
const REASONS: [string, string][] = [
  ["SALARY_TIMING", "Salary not yet received"],
  ["TEMPORARY_SHORTFALL", "Temporary cash shortfall"],
  ["INCOME_INTERRUPTION", "Income interruption"],
  ["AFFORDABILITY", "Affordability difficulty"],
  ["FORGOT", "Forgot"],
  ["TECHNICAL_PAYMENT_ISSUE", "Payment-channel problem"],
  ["DISPUTED_DEBT", "Debt / payment disputed"],
  ["OTHER", "Other (short note)"],
  ["NOT_STATED", "Not stated / declined"],
];
const OUTCOMES_RPC: [string, string, string][] = [
  ["PTP", "Payment promise", "amount, date, covered loans; coverage derived"],
  ["CALLBACK_REQUESTED", "Requested callback", "agreed time window"],
  ["ALREADY_PAID_CLAIM", "Already paid (claim)", "reconciliation route"],
  ["NO_COMMITMENT", "No payment commitment", "neutral subreason"],
  ["DISPUTE", "Dispute", "specialist review"],
  ["SUPPORT_NEEDED", "Repayment support", "referral, no contract change"],
  ["REFUSED", "Declines discussion", "policy-derived follow-up"],
];
const OUTCOMES_THIRD_PARTY: [string, string, string][] = [
  ["NO_CONVERSATION", "No borrower conversation", "message left per privacy script"],
  ["SPECIAL_REFERRAL", "Special-case referral", "deceased / legal / special handling"],
];
const FLAGS: [string, string][] = [
  ["SUPPORT_REFERRAL_REQUESTED", "Support follow-up"],
  ["DISPUTE_RAISED", "Dispute raised"],
  ["CONTACT_DETAILS_CHANGED", "Contact details changed"],
  ["VULNERABILITY_INDICATED", "Vulnerability indicated"],
];
export const OUTCOME_LABELS_UI: Record<string, string> = { PTP: "Payment promise (full coverage)", PARTIAL_COMMITMENT: "Payment promise (partial coverage)", NO_COMMITMENT: "No payment commitment", CALLBACK_REQUESTED: "Requested callback", ALREADY_PAID_CLAIM: "Already paid (claim)", DISPUTE: "Dispute", SUPPORT_NEEDED: "Repayment support", REFUSED: "Declines discussion", SPECIAL_REFERRAL: "Special-case referral", NO_CONVERSATION: "No conversation" };

export function allowedOutcomes(identity: string | undefined): string[] {
  if (identity === "RPC_VERIFIED") return OUTCOMES_RPC.map((o) => o[0]);
  if (identity === "THIRD_PARTY") return OUTCOMES_THIRD_PARTY.map((o) => o[0]);
  if (identity) return ["NO_CONVERSATION"];
  return [];
}

export interface PreviewResult {
  nextAction: string;
  summary: string;
  routineCallsBlockedUntil: string | null;
  cooldownUntil: string | null;
  ptpProtectionUntil: string | null;
  callbackAt: string | null;
  reconciliationHoldUntil: string | null;
  digitalReminders: string;
  referral: string | null;
  errors: string[];
  derivedOutcome: string;
  coverage: "FULL" | "PARTIAL" | "NOTHING_DUE" | null;
  coveredOverdue: string | null;
  factualSummary: string;
  policyVersion: string;
}

function Choice({ pressed, onClick, label, hint, disabled, testId }: { pressed: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" className="choice" aria-pressed={pressed} onClick={onClick} disabled={disabled} data-testid={testId}>
      <span>{label}</span>
      {hint && <span className="choice-hint">{hint}</span>}
    </button>
  );
}

export function OutcomeForm({ ctx, draft, onChange, onPreview, serverNow }: { ctx: AgentContext; draft: OutcomeDraft; onChange: (d: OutcomeDraft) => void; onPreview: (p: PreviewResult | null) => void; compact?: boolean; serverNow: () => Date }) {
  const interaction = ctx.interaction!;
  const customer = ctx.customer;
  const overdueLoans = useMemo(() => (customer?.loans ?? []).filter((l) => Number(l.totalOverdue) > 0), [customer]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [customAmount, setCustomAmount] = useState(false);
  const [customDate, setCustomDate] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idKey = useRef<string | null>(null);
  const locked = interaction.status === "SAVED" || interaction.status === "CORRECTED";

  const set = (patch: Partial<OutcomeDraft>) => {
    if (locked) return;
    setSaveState("saving");
    const next = { ...draft, ...patch };
    if (patch.identityStatus !== undefined) {
      // Never preselect a positive outcome: only auto-fill when exactly one outcome is possible.
      const allowed = allowedOutcomes(patch.identityStatus);
      if (!allowed.includes(next.businessOutcome ?? "")) next.businessOutcome = allowed.length === 1 ? allowed[0] : undefined;
      if (patch.identityStatus !== "RPC_VERIFIED") { next.nonPaymentReason = null; next.ptp = null; next.callback = null; next.paidClaim = null; next.dispute = null; next.customerStatement = null; next.secondaryFlags = []; }
      if (patch.identityStatus !== "WRONG_NUMBER") next.wrongNumber = null;
    }
    if (patch.businessOutcome !== undefined) {
      if (!["PTP", "PARTIAL_COMMITMENT"].includes(patch.businessOutcome ?? "")) next.ptp = null;
      if (patch.businessOutcome !== "CALLBACK_REQUESTED") next.callback = null;
      if (patch.businessOutcome !== "ALREADY_PAID_CLAIM") next.paidClaim = null;
      if (patch.businessOutcome !== "DISPUTE") next.dispute = null;
      if (!["SUPPORT_NEEDED", "SPECIAL_REFERRAL"].includes(patch.businessOutcome ?? "")) next.support = null;
      if (!["NO_COMMITMENT", "REFUSED", "CALLBACK_REQUESTED"].includes(patch.businessOutcome ?? "")) next.customerStatement = null;
    }
    onChange(next);
  };

  // Auto-save a recoverable draft (debounced) and refresh the next-action preview. Drafts never submit anything.
  useEffect(() => {
    if (locked) return;
    if (timer.current) clearTimeout(timer.current);
    if (!idKey.current) idKey.current = `${interaction.id}-${Math.random().toString(36).slice(2, 10)}`;
    timer.current = setTimeout(async () => {
      const r = await api(`/api/agent/interactions/${interaction.id}/draft`, { ...draft, idempotencyKey: idKey.current });
      setSaveState(r.ok ? "saved" : "error");
    }, 1200);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      if (!draft.identityStatus || !draft.businessOutcome) return onPreview(null);
      const r = await api<PreviewResult>(`/api/agent/interactions/${interaction.id}/preview`, { ...draft, idempotencyKey: idKey.current, returnReady: draft.returnReady ?? true });
      onPreview(r.ok ? r.data : null);
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), interaction.id, locked]);

  const rpc = draft.identityStatus === "RPC_VERIFIED";
  const thirdParty = draft.identityStatus === "THIRD_PARTY";
  const today = bakuTodayIso(ctx.serverNow);
  const overdueTotal = overdueLoans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2);
  const nextInstallment = customer?.summary.nextDue?.amount ?? null;
  const suggestedLoans = () => (overdueLoans.length ? overdueLoans : (customer?.loans ?? [])).map((l) => l.id);
  const ptpBase = () => draft.ptp ?? { amount: "", deadlineDate: "", coveredLoanIds: suggestedLoans(), customerConfirmed: false };
  const plusDays = (n: number) => { const d = new Date(serverNow().getTime() + n * 86400000); return d.toISOString().slice(0, 10); };
  const showReason = rpc && ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED", "ALREADY_PAID_CLAIM", "DISPUTE"].includes(draft.businessOutcome ?? "");
  const toggleFlag = (f: string) => { const cur = new Set(draft.secondaryFlags ?? []); if (cur.has(f)) cur.delete(f); else cur.add(f); set({ secondaryFlags: [...cur] }); };

  return (
    <div className="space-y-3" aria-live="polite">
      <section aria-labelledby="step-a">
        <p className="step-label" id="step-a"><span className="step-no">A</span> Who is speaking?</p>
        <div className="choice-grid">
          {IDENTITY.map(([k, l, h]) => <Choice key={k} testId={`identity-${k}`} pressed={draft.identityStatus === k} onClick={() => { if (draft.identityStatus !== k) set({ identityStatus: k }); }} label={l} hint={h} disabled={locked} />)}
        </div>
        {!draft.identityStatus && <p className="mt-1 text-xs text-muted">Nothing is preselected. "Verified" means the bank's approved procedure was completed, not that the line was answered.</p>}
        {draft.identityStatus === "WRONG_NUMBER" && (
          <Field label="Which contact point is wrong?" htmlFor="wrong-cp" required>
            <Select id="wrong-cp" value={draft.wrongNumber?.contactPointId ?? ""} onChange={(e) => set({ wrongNumber: e.target.value ? { contactPointId: e.target.value } : null })} disabled={locked}>
              <option value="">Select…</option>
              {(customer?.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.type} {c.value} {c.isPrimary ? "(primary)" : ""}</option>)}
            </Select>
          </Field>
        )}
      </section>

      {rpc && (
        <section aria-labelledby="step-b">
          <p className="step-label" id="step-b"><span className="step-no">B</span> Reason the customer gives (when stated)</p>
          <div className="chip-row">
            {REASONS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={draft.nonPaymentReason === k} data-testid={`reason-${k}`} disabled={locked} onClick={() => set({ nonPaymentReason: draft.nonPaymentReason === k ? null : k })}>{l}</button>)}
          </div>
          {showReason && !draft.nonPaymentReason && <p className="mt-1 text-xs text-warning">Required for this outcome; choose "Not stated / declined" if the customer gave no reason.</p>}
        </section>
      )}

      {(rpc || thirdParty) && (
        <section aria-labelledby="step-c">
          <p className="step-label" id="step-c"><span className="step-no">C</span> What was agreed / what happened</p>
          <div className="choice-grid">
            {(rpc ? OUTCOMES_RPC : OUTCOMES_THIRD_PARTY).map(([k, l, h]) => <Choice key={k} testId={`outcome-${k}`} pressed={draft.businessOutcome === k || (k === "PTP" && draft.businessOutcome === "PARTIAL_COMMITMENT")} onClick={() => { if (draft.businessOutcome !== k) set({ businessOutcome: k }); }} label={l} hint={h} disabled={locked} />)}
          </div>
        </section>
      )}
      {draft.identityStatus && !rpc && !thirdParty && <p className="text-xs text-muted">Outcome recorded as "No conversation" (no verified borrower contact). {draft.identityStatus === "WRONG_NUMBER" ? "The contact point will be flagged." : ""}</p>}

      {(draft.businessOutcome === "PTP" || draft.businessOutcome === "PARTIAL_COMMITMENT") && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Payment promise · explicit customer agreement</legend>
          <p className="mb-1 text-xs text-muted">Suggestions come from bank-verified amounts; the customer's actual agreement must be confirmed below.</p>
          <p className="label">Amount (AZN)</p>
          <div className="chip-row mb-2">
            {Number(overdueTotal) > 0 && <button type="button" className="chip" data-testid="ptp-amount-overdue" aria-pressed={!customAmount && draft.ptp?.amount === overdueTotal} disabled={locked} onClick={() => { setCustomAmount(false); set({ ptp: { ...ptpBase(), amount: overdueTotal } }); }}>Overdue due now {fmtAzn(overdueTotal, false)}</button>}
            {nextInstallment && <button type="button" className="chip" data-testid="ptp-amount-installment" aria-pressed={!customAmount && draft.ptp?.amount === nextInstallment} disabled={locked} onClick={() => { setCustomAmount(false); set({ ptp: { ...ptpBase(), amount: nextInstallment } }); }}>Next installment {fmtAzn(nextInstallment, false)}</button>}
            <button type="button" className="chip" aria-pressed={customAmount} disabled={locked} onClick={() => setCustomAmount(true)}>Other amount</button>
          </div>
          {customAmount && <Field label="Agreed amount (AZN)" htmlFor="ptp-amount" required><Input id="ptp-amount" inputMode="decimal" value={draft.ptp?.amount ?? ""} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), amount: e.target.value } })} /></Field>}
          <p className="label">Deadline (Baku, end of day)</p>
          <div className="chip-row mb-2">
            {[["Today", today], ["+3 days", plusDays(3)], ["+7 days", plusDays(7)]].map(([l, d]) => <button key={l} type="button" className="chip" data-testid={`ptp-date-${l.replace(/\W/g, "")}`} aria-pressed={!customDate && draft.ptp?.deadlineDate === d} disabled={locked} onClick={() => { setCustomDate(false); set({ ptp: { ...ptpBase(), deadlineDate: d } }); }}>{l} · {fmtDate(d)}</button>)}
            <button type="button" className="chip" aria-pressed={customDate} disabled={locked} onClick={() => setCustomDate(true)}>Other date</button>
          </div>
          {customDate && <Field label="Agreed deadline" htmlFor="ptp-date" required><Input id="ptp-date" type="date" min={today} value={draft.ptp?.deadlineDate ?? ""} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), deadlineDate: e.target.value } })} /></Field>}
          <p className="label">Covered obligation(s)</p>
          <div className="mb-2">
            {(customer?.loans ?? []).map((l) => (
              <label key={l.id} className="mr-4 inline-flex items-center gap-1 text-sm">
                <input type="checkbox" checked={(draft.ptp?.coveredLoanIds ?? suggestedLoans()).includes(l.id)} disabled={locked} onChange={(e) => { const cur = new Set(draft.ptp?.coveredLoanIds ?? suggestedLoans()); if (e.target.checked) cur.add(l.id); else cur.delete(l.id); set({ ptp: { ...ptpBase(), coveredLoanIds: [...cur] } }); }} />
                {l.coreLoanId} · overdue {fmtAzn(l.totalOverdue)}
              </label>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" data-testid="ptp-confirm" checked={!!draft.ptp?.customerConfirmed} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), customerConfirmed: e.target.checked } })} />
            The customer explicitly agreed to this amount and date
          </label>
          <p className="mt-1 text-xs text-muted">"I might pay Friday" is not a promise: record it under "No payment commitment" as a statement. A promise never rewrites the contract.</p>
        </fieldset>
      )}

      {draft.businessOutcome === "CALLBACK_REQUESTED" && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Requested callback</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Agreed time (Asia/Baku)" htmlFor="cb-time" required hint="Policy re-checks eligibility at dispatch; outside permitted hours the next permitted time is used.">
              <Input id="cb-time" type="datetime-local" disabled={locked} value={toBakuLocalInput(draft.callback?.dueAt ?? null) || toBakuLocalInput(new Date(serverNow().getTime() + 24 * 3600000).toISOString())} onChange={(e) => set({ callback: { customerRequested: true, ownerMode: "ME", ...(draft.callback ?? {}), dueAt: fromBakuLocalInput(e.target.value) ?? "" } })} />
            </Field>
            <Field label="Owner" htmlFor="cb-owner">
              <Select id="cb-owner" disabled={locked} value={draft.callback?.ownerMode ?? "ME"} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? new Date(serverNow().getTime() + 24 * 3600000).toISOString(), customerRequested: draft.callback?.customerRequested ?? true, ownerMode: e.target.value as "ME" | "POOL" } })}>
                <option value="ME">Me (named owner, pool fallback if unavailable)</option>
                <option value="POOL">Eligible pool</option>
              </Select>
            </Field>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={locked} checked={draft.callback?.customerRequested ?? true} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? new Date(serverNow().getTime() + 24 * 3600000).toISOString(), ownerMode: draft.callback?.ownerMode ?? "ME", customerRequested: e.target.checked } })} />
            Requested by the customer (evidenced exception to the cooldown under policy)
          </label>
        </fieldset>
      )}

      {draft.businessOutcome === "ALREADY_PAID_CLAIM" && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Claimed payment (customer-stated, not a posting)</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Amount (AZN)" htmlFor="claim-amount" hint="leave empty if unknown"><Input id="claim-amount" inputMode="decimal" disabled={locked} value={draft.paidClaim?.amount ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), amount: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label="Date" htmlFor="claim-date"><Input id="claim-date" type="date" max={today} disabled={locked} value={draft.paidClaim?.date ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), date: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label="Channel" htmlFor="claim-channel"><Input id="claim-channel" disabled={locked} value={draft.paidClaim?.channel ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), channel: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label="Reference" htmlFor="claim-ref"><Input id="claim-ref" disabled={locked} value={draft.paidClaim?.reference ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), reference: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
          </div>
          {!draft.paidClaim && <button type="button" className="chip mt-2" data-testid="claim-unknown" disabled={locked} onClick={() => set({ paidClaim: {} })}>Details unknown — record the claim as stated</button>}
          <p className="mt-1 text-xs text-muted">Opens a reconciliation task and a temporary hold. Balances change only after a verified core posting; the summary keeps it a claim.</p>
        </fieldset>
      )}

      {(draft.businessOutcome === "NO_COMMITMENT" || draft.businessOutcome === "REFUSED" || draft.businessOutcome === "CALLBACK_REQUESTED") && rpc && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Customer statement (optional, not a commitment)</legend>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Mentioned payment date" htmlFor="stmt-date" hint="e.g. 'might pay Friday'"><Input id="stmt-date" type="date" disabled={locked} value={draft.customerStatement?.indicativePaymentDate ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), indicativePaymentDate: e.target.value || null } })} /></Field>
            <Field label="Mentioned amount (AZN)" htmlFor="stmt-amount"><Input id="stmt-amount" inputMode="decimal" disabled={locked} value={draft.customerStatement?.indicativeAmount ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), indicativeAmount: e.target.value || null } })} /></Field>
            <Field label="Statement" htmlFor="stmt-text"><Input id="stmt-text" disabled={locked} value={draft.customerStatement?.text ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), text: e.target.value || null } })} /></Field>
          </div>
          <p className="mt-1 text-xs text-muted">Recorded with provenance as a customer statement. No promise, reminder or protection is created from it.</p>
        </fieldset>
      )}

      {draft.businessOutcome === "DISPUTE" && (
        <Field label="Dispute category / reason (customer-stated)" htmlFor="dispute" required><Input id="dispute" disabled={locked} value={draft.dispute?.reason ?? ""} onChange={(e) => set({ dispute: { reason: e.target.value } })} /></Field>
      )}
      {(draft.businessOutcome === "SUPPORT_NEEDED" || draft.businessOutcome === "SPECIAL_REFERRAL") && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Referral</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Type" htmlFor="support-type" required>
              <Select id="support-type" disabled={locked} value={draft.support?.type ?? ""} onChange={(e) => set({ support: { reason: draft.support?.reason ?? "", type: e.target.value as NonNullable<OutcomeDraft["support"]>["type"] } })}>
                <option value="">Select…</option>
                {draft.businessOutcome === "SUPPORT_NEEDED" ? <><option value="HARDSHIP">Hardship / repayment support</option><option value="COMPLAINT">Complaint</option></> : <><option value="SPECIAL_HANDLING">Special handling</option><option value="DECEASED_LEGAL">Deceased / legal notification</option></>}
              </Select>
            </Field>
            <Field label="Reason (short, factual)" htmlFor="support-reason" required><Input id="support-reason" disabled={locked} value={draft.support?.reason ?? ""} onChange={(e) => set({ support: { type: draft.support?.type ?? (draft.businessOutcome === "SUPPORT_NEEDED" ? "HARDSHIP" : "SPECIAL_HANDLING"), reason: e.target.value } })} /></Field>
          </div>
        </fieldset>
      )}

      {rpc && draft.businessOutcome && (
        <section aria-labelledby="step-flags">
          <p className="step-label" id="step-flags"><span className="step-no">+</span> Also noted (independent facts)</p>
          <div className="chip-row">{FLAGS.map(([k, l]) => <button key={k} type="button" className="chip" data-testid={`flag-${k}`} aria-pressed={(draft.secondaryFlags ?? []).includes(k)} disabled={locked} onClick={() => toggleFlag(k)}>{l}</button>)}</div>
        </section>
      )}

      <Field label="Note" htmlFor="note" hint={draft.nonPaymentReason === "OTHER" || draft.businessOutcome === "SPECIAL_REFERRAL" || (draft.secondaryFlags ?? []).some((f) => f === "DISPUTE_RAISED" || f === "SUPPORT_REFERRAL_REQUESTED") ? "Short factual note required for 'Other', special referrals and flagged dispute/support." : "Optional. Facts only; no judgement labels."}>
        <Textarea id="note" disabled={locked} value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} rows={2} />
      </Field>
      <div className="flex items-center gap-2 text-xs">
        <Badge tone={saveState === "saved" ? "info" : saveState === "error" ? "danger" : "neutral"}>{saveState === "saving" ? "Saving draft…" : saveState === "saved" ? "Draft saved / not submitted" : saveState === "error" ? "Draft save failed" : "Draft"}</Badge>
        <span className="text-muted">A draft never commits an agreement; one final save does.</span>
      </div>
    </div>
  );
}
