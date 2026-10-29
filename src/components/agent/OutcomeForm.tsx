"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn, fmtDate, bakuTodayIso, toBakuLocalInput, fromBakuLocalInput } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";

/**
 * Guided responses: Step A who is speaking → Step B customer-stated reason → Step C agreed outcome with
 * conditional fields → independent flags → optional note. Nothing is preselected, bank facts are suggestions only,
 * every customer agreement is explicitly confirmed, an out-of-policy date becomes a proposed exception (never a
 * promise), a death report captures who reported it, and "Overdue cleared" appears only when the fresh snapshot
 * shows nothing overdue.
 */
const IDENTITY = ["RPC_VERIFIED", "THIRD_PARTY", "VERIFICATION_FAILED", "WRONG_PERSON", "WRONG_NUMBER"] as const;
const REASONS = ["SALARY_TIMING", "TEMPORARY_SHORTFALL", "INCOME_INTERRUPTION", "AFFORDABILITY", "FORGOT", "TECHNICAL_PAYMENT_ISSUE", "DISPUTED_DEBT", "OTHER", "NOT_STATED"] as const;
const OUTCOMES_RPC = ["PTP", "CALLBACK_REQUESTED", "ALREADY_PAID_CLAIM", "NO_COMMITMENT", "DISPUTE", "SUPPORT_NEEDED", "REFUSED", "SPECIAL_REFERRAL"] as const;
const OUTCOMES_THIRD_PARTY = ["NO_CONVERSATION", "SPECIAL_REFERRAL"] as const;
const FLAGS = ["SUPPORT_REFERRAL_REQUESTED", "DISPUTE_RAISED", "CONTACT_DETAILS_CHANGED", "VULNERABILITY_INDICATED"] as const;
const REPORTERS = ["SPOUSE", "CHILD", "PARENT", "SIBLING", "RELATIVE", "EMPLOYER", "LEGAL_REPRESENTATIVE", "OTHER"] as const;
const REPORTER_LABELS: Record<string, Record<(typeof REPORTERS)[number], string>> = {
  en: { SPOUSE: "Spouse", CHILD: "Child", PARENT: "Parent", SIBLING: "Sibling", RELATIVE: "Other relative", EMPLOYER: "Employer", LEGAL_REPRESENTATIVE: "Legal representative", OTHER: "Other" },
  az: { SPOUSE: "Həyat yoldaşı", CHILD: "Övlad", PARENT: "Valideyn", SIBLING: "Bacı / qardaş", RELATIVE: "Digər qohum", EMPLOYER: "İşəgötürən", LEGAL_REPRESENTATIVE: "Hüquqi nümayəndə", OTHER: "Digər" },
  ru: { SPOUSE: "Супруг(а)", CHILD: "Ребёнок", PARENT: "Родитель", SIBLING: "Брат / сестра", RELATIVE: "Другой родственник", EMPLOYER: "Работодатель", LEGAL_REPRESENTATIVE: "Законный представитель", OTHER: "Другое" },
};
export const OUTCOME_LABELS_UI: Record<string, string> = { PTP: "Payment promise (full coverage)", PARTIAL_COMMITMENT: "Payment promise (partial coverage)", NO_COMMITMENT: "No payment commitment", CALLBACK_REQUESTED: "Requested callback", ALREADY_PAID_CLAIM: "Already paid (claim)", DISPUTE: "Dispute", SUPPORT_NEEDED: "Repayment support", REFUSED: "Declines discussion", SPECIAL_REFERRAL: "Special-case referral", NO_CONVERSATION: "No conversation", DELINQUENCY_CLOSED: "Overdue cleared during the call", PTP_EXCEPTION_PROPOSED: "Promise-date exception proposed" };

export function allowedOutcomes(identity: string | undefined, overdueCleared = false): string[] {
  if (identity === "RPC_VERIFIED") return [...OUTCOMES_RPC, ...(overdueCleared ? ["DELINQUENCY_CLOSED"] : []), "PTP_EXCEPTION_PROPOSED"];
  if (identity === "THIRD_PARTY") return [...OUTCOMES_THIRD_PARTY];
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

export function OutcomeForm({ ctx, locale, draft, onChange, onPreview, serverNow }: { ctx: AgentContext; locale: Locale; draft: OutcomeDraft; onChange: (d: OutcomeDraft) => void; onPreview: (p: PreviewResult | null) => void; serverNow: () => Date }) {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const interaction = ctx.interaction!;
  const customer = ctx.customer;
  const overdueLoans = useMemo(() => (customer?.loans ?? []).filter((l) => Number(l.totalOverdue) > 0), [customer]);
  const overdueCleared = !!customer && Number(customer.summary.overdueDueNow) <= 0;
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [customAmount, setCustomAmount] = useState(false);
  const [customDate, setCustomDate] = useState(false);
  const [customCallback, setCustomCallback] = useState(false);
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
      const allowed = allowedOutcomes(patch.identityStatus, overdueCleared);
      if (!allowed.includes(next.businessOutcome ?? "")) next.businessOutcome = allowed.length === 1 ? allowed[0] : undefined;
      if (patch.identityStatus !== "RPC_VERIFIED") { next.nonPaymentReason = null; next.ptp = null; next.callback = null; next.paidClaim = null; next.dispute = null; next.customerStatement = null; next.secondaryFlags = []; }
      if (patch.identityStatus !== "WRONG_NUMBER") next.wrongNumber = null;
    }
    if (patch.businessOutcome !== undefined) {
      if (!["PTP", "PARTIAL_COMMITMENT", "PTP_EXCEPTION_PROPOSED"].includes(patch.businessOutcome ?? "")) next.ptp = null;
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
  const cbSlot = (daysAhead: number, hm: string) => fromBakuLocalInput(`${bakuTodayIso(new Date(serverNow().getTime() + daysAhead * 86400000).toISOString())}T${hm}`) ?? "";
  const showReason = rpc && ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED", "ALREADY_PAID_CLAIM", "DISPUTE", "PTP_EXCEPTION_PROPOSED"].includes(draft.businessOutcome ?? "");
  const toggleFlag = (f: string) => { const cur = new Set(draft.secondaryFlags ?? []); if (cur.has(f)) cur.delete(f); else cur.add(f); set({ secondaryFlags: [...cur] }); };
  const isPromise = draft.businessOutcome === "PTP" || draft.businessOutcome === "PARTIAL_COMMITMENT";
  const isException = draft.businessOutcome === "PTP_EXCEPTION_PROPOSED";
  const maxDate = ctx.promisePolicy?.maxDate ?? null;
  const beyondHorizon = !!draft.ptp?.deadlineDate && !!maxDate && draft.ptp.deadlineDate > maxDate;
  const rpcOutcomes = overdueCleared ? ["DELINQUENCY_CLOSED", ...OUTCOMES_RPC] : [...OUTCOMES_RPC];
  const deceased = draft.support?.type === "DECEASED_LEGAL";
  const reporterLabels = REPORTER_LABELS[locale] ?? REPORTER_LABELS.en;

  return (
    <div className="space-y-3" aria-live="polite">
      <section aria-labelledby="step-a">
        <p className="step-label" id="step-a"><span className="step-no">A</span> {tt("agent.form.who")}</p>
        <div className="choice-grid">
          {IDENTITY.map((k) => <Choice key={k} testId={`identity-${k}`} pressed={draft.identityStatus === k} onClick={() => { if (draft.identityStatus !== k) set({ identityStatus: k }); }} label={tt(`agent.identity.${k}`)} hint={tt(`agent.identityHint.${k}`)} disabled={locked} />)}
        </div>
        {!draft.identityStatus && <p className="mt-1 text-xs text-muted">{tt("agent.form.whoHint")}</p>}
        {draft.identityStatus === "WRONG_NUMBER" && (
          <Field label={tt("agent.form.wrongCp")} htmlFor="wrong-cp" required>
            <Select id="wrong-cp" value={draft.wrongNumber?.contactPointId ?? ""} onChange={(e) => set({ wrongNumber: e.target.value ? { contactPointId: e.target.value } : null })} disabled={locked}>
              <option value="">{tt("agent.form.select")}</option>
              {(customer?.contacts ?? []).map((c) => <option key={c.id} value={c.id}>{c.type} {c.value} {c.isPrimary ? "(primary)" : ""}</option>)}
            </Select>
          </Field>
        )}
      </section>

      {rpc && (
        <section aria-labelledby="step-b">
          <p className="step-label" id="step-b"><span className="step-no">B</span> {tt("agent.form.reason")}</p>
          <div className="chip-row">
            {REASONS.map((k) => <button key={k} type="button" className="chip" aria-pressed={draft.nonPaymentReason === k} data-testid={`reason-${k}`} disabled={locked} onClick={() => set({ nonPaymentReason: draft.nonPaymentReason === k ? null : k })}>{tt(`agent.reasons.${k}`)}</button>)}
          </div>
          {showReason && !draft.nonPaymentReason && <p className="mt-1 text-xs text-warning">{tt("agent.form.reasonRequired")}</p>}
        </section>
      )}

      {(rpc || thirdParty) && (
        <section aria-labelledby="step-c">
          <p className="step-label" id="step-c"><span className="step-no">C</span> {tt("agent.form.outcome")}</p>
          {rpc && overdueCleared && <p className="callout callout-success mb-2 text-xs" data-testid="overdue-cleared-hint">{tt("agent.form.closedNote")}</p>}
          <div className="choice-grid">
            {(rpc ? rpcOutcomes : [...OUTCOMES_THIRD_PARTY]).map((k) => <Choice key={k} testId={`outcome-${k}`} pressed={draft.businessOutcome === k || (k === "PTP" && (draft.businessOutcome === "PARTIAL_COMMITMENT" || draft.businessOutcome === "PTP_EXCEPTION_PROPOSED"))} onClick={() => { if (draft.businessOutcome !== k) set({ businessOutcome: k }); }} label={tt(`agent.outcomes.${k}`)} hint={tt(`agent.outcomeHints.${k}`)} disabled={locked} />)}
          </div>
        </section>
      )}
      {draft.identityStatus && !rpc && !thirdParty && <p className="text-xs text-muted">{tt("agent.form.noConversation")}</p>}

      {(isPromise || isException) && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.form.promise")}</legend>
          <p className="mb-1 text-xs text-muted">{tt("agent.form.promiseHint")}</p>
          <p className="label">{tt("agent.form.amount")}</p>
          <div className="chip-row mb-2">
            {Number(overdueTotal) > 0 && <button type="button" className="chip" data-testid="ptp-amount-overdue" aria-pressed={!customAmount && draft.ptp?.amount === overdueTotal} disabled={locked} onClick={() => { setCustomAmount(false); set({ ptp: { ...ptpBase(), amount: overdueTotal } }); }}>{tt("agent.form.overdueNow")} {fmtAzn(overdueTotal, false)}</button>}
            {nextInstallment && <button type="button" className="chip" data-testid="ptp-amount-installment" aria-pressed={!customAmount && draft.ptp?.amount === nextInstallment} disabled={locked} onClick={() => { setCustomAmount(false); set({ ptp: { ...ptpBase(), amount: nextInstallment } }); }}>{tt("agent.form.nextInstallment")} {fmtAzn(nextInstallment, false)}</button>}
            <button type="button" className="chip" aria-pressed={customAmount} disabled={locked} onClick={() => setCustomAmount(true)}>{tt("agent.form.otherAmount")}</button>
          </div>
          {customAmount && <Field label={tt("agent.form.amount")} htmlFor="ptp-amount" required><Input id="ptp-amount" inputMode="decimal" value={draft.ptp?.amount ?? ""} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), amount: e.target.value } })} /></Field>}
          <p className="label">{tt("agent.form.deadline")}</p>
          <div className="chip-row mb-2">
            {[[tt("agent.form.today"), today, "Today"], [tt("agent.form.plus3"), plusDays(3), "3days"], [tt("agent.form.plus7"), plusDays(7), "7days"]].map(([l, d, id]) => <button key={id} type="button" className="chip" data-testid={`ptp-date-${id}`} aria-pressed={!customDate && draft.ptp?.deadlineDate === d} disabled={locked} onClick={() => { setCustomDate(false); set({ ptp: { ...ptpBase(), deadlineDate: d } }); }}>{l} · {fmtDate(d)}</button>)}
            <button type="button" className="chip" aria-pressed={customDate} disabled={locked} onClick={() => setCustomDate(true)}>{tt("agent.form.otherDate")}</button>
          </div>
          {customDate && <Field label={tt("agent.form.deadline")} htmlFor="ptp-date" required><Input id="ptp-date" type="date" min={today} value={draft.ptp?.deadlineDate ?? ""} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), deadlineDate: e.target.value } })} data-testid="ptp-date-input" /></Field>}
          {isPromise && beyondHorizon && ctx.promisePolicy && (
            <div className="callout callout-warning mb-2 text-xs" data-testid="horizon-warning">
              <p>{tt("agent.form.horizon", { days: ctx.promisePolicy.maxHorizonDays, max: fmtDate(ctx.promisePolicy.maxDate) })}</p>
              <Button size="sm" className="mt-1" disabled={locked} onClick={() => set({ businessOutcome: "PTP_EXCEPTION_PROPOSED" })} data-testid="to-exception">{tt("agent.form.toException")}</Button>
            </div>
          )}
          {isException && <p className="callout callout-info mb-2 text-xs" data-testid="exception-note">{tt("agent.form.exceptionNote")}{maxDate ? ` (${tt("agent.form.horizon", { days: ctx.promisePolicy?.maxHorizonDays ?? "", max: fmtDate(maxDate) }).split(".")[0]}.)` : ""}</p>}
          <p className="label">{tt("agent.form.covered")}</p>
          <div className="mb-2">
            {(customer?.loans ?? []).map((l) => (
              <label key={l.id} className="mr-4 inline-flex items-center gap-1 text-sm">
                <input type="checkbox" checked={(draft.ptp?.coveredLoanIds ?? suggestedLoans()).includes(l.id)} disabled={locked} onChange={(e) => { const cur = new Set(draft.ptp?.coveredLoanIds ?? suggestedLoans()); if (e.target.checked) cur.add(l.id); else cur.delete(l.id); set({ ptp: { ...ptpBase(), coveredLoanIds: [...cur] } }); }} />
                {l.coreLoanId} · {fmtAzn(l.totalOverdue)}
              </label>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" data-testid="ptp-confirm" checked={!!draft.ptp?.customerConfirmed} disabled={locked} onChange={(e) => set({ ptp: { ...ptpBase(), customerConfirmed: e.target.checked } })} />
            {tt("agent.form.confirm")}
          </label>
          <p className="mt-1 text-xs text-muted">{tt("agent.form.promiseNote")}</p>
        </fieldset>
      )}

      {draft.businessOutcome === "CALLBACK_REQUESTED" && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.form.callback")}</legend>
          <p className="label">{tt("agent.form.agreedTime")}</p>
          <div className="chip-row mb-2">
            {[["cb-time-tomorrow-10", tt("agent.form.tomorrow10"), cbSlot(1, "10:00")], ["cb-time-tomorrow-18", tt("agent.form.tomorrow18"), cbSlot(1, "18:00")], ["cb-time-plus2h", tt("agent.form.in2h"), new Date(serverNow().getTime() + 2 * 3600000).toISOString()]].map(([id, label, iso]) => (
              <button key={id} type="button" className="chip" data-testid={id} aria-pressed={!customCallback && draft.callback?.dueAt === iso} disabled={locked} onClick={() => { setCustomCallback(false); set({ callback: { customerRequested: draft.callback?.customerRequested ?? true, ownerMode: draft.callback?.ownerMode ?? "ME", dueAt: iso } }); }}>{label}</button>
            ))}
            <button type="button" className="chip" aria-pressed={customCallback} disabled={locked} onClick={() => setCustomCallback(true)}>{tt("agent.form.otherTime")}</button>
          </div>
          {customCallback && (
            <Field label={tt("agent.form.agreedTime")} htmlFor="cb-time" required>
              <Input id="cb-time" type="datetime-local" disabled={locked} value={toBakuLocalInput(draft.callback?.dueAt ?? null)} onChange={(e) => set({ callback: { customerRequested: draft.callback?.customerRequested ?? true, ownerMode: draft.callback?.ownerMode ?? "ME", dueAt: fromBakuLocalInput(e.target.value) ?? "" } })} />
            </Field>
          )}
          {!draft.callback?.dueAt && <p className="mt-1 text-xs text-warning">{tt("agent.form.chooseTime")}</p>}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tt("common.owner")} htmlFor="cb-owner">
              <Select id="cb-owner" disabled={locked || !draft.callback?.dueAt} value={draft.callback?.ownerMode ?? "ME"} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? "", customerRequested: draft.callback?.customerRequested ?? true, ownerMode: e.target.value as "ME" | "POOL" } })}>
                <option value="ME">{tt("agent.form.ownerMe")}</option>
                <option value="POOL">{tt("agent.form.ownerPool")}</option>
              </Select>
            </Field>
            <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" disabled={locked || !draft.callback?.dueAt} checked={draft.callback?.customerRequested ?? true} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? "", ownerMode: draft.callback?.ownerMode ?? "ME", customerRequested: e.target.checked } })} />
              {tt("agent.form.customerRequested")}
            </label>
          </div>
        </fieldset>
      )}

      {draft.businessOutcome === "ALREADY_PAID_CLAIM" && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.form.claim")}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tt("agent.form.amount")} htmlFor="claim-amount"><Input id="claim-amount" inputMode="decimal" disabled={locked} value={draft.paidClaim?.amount ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), amount: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label={tt("common.date")} htmlFor="claim-date"><Input id="claim-date" type="date" max={today} disabled={locked} value={draft.paidClaim?.date ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), date: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label="Channel" htmlFor="claim-channel"><Input id="claim-channel" disabled={locked} value={draft.paidClaim?.channel ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), channel: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
            <Field label="Reference" htmlFor="claim-ref"><Input id="claim-ref" disabled={locked} value={draft.paidClaim?.reference ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), reference: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} /></Field>
          </div>
          {!draft.paidClaim && <button type="button" className="chip mt-2" data-testid="claim-unknown" disabled={locked} onClick={() => set({ paidClaim: {} })}>{tt("agent.form.claimUnknown")}</button>}
          <p className="mt-1 text-xs text-muted">{tt("agent.form.claimNote")}</p>
        </fieldset>
      )}

      {(draft.businessOutcome === "NO_COMMITMENT" || draft.businessOutcome === "REFUSED" || draft.businessOutcome === "CALLBACK_REQUESTED") && rpc && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{tt("agent.form.statement")}</legend>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={tt("common.date")} htmlFor="stmt-date"><Input id="stmt-date" type="date" disabled={locked} value={draft.customerStatement?.indicativePaymentDate ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), indicativePaymentDate: e.target.value || null } })} /></Field>
            <Field label={tt("agent.form.amount")} htmlFor="stmt-amount"><Input id="stmt-amount" inputMode="decimal" disabled={locked} value={draft.customerStatement?.indicativeAmount ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), indicativeAmount: e.target.value || null } })} /></Field>
            <Field label={tt("agent.form.note")} htmlFor="stmt-text"><Input id="stmt-text" disabled={locked} value={draft.customerStatement?.text ?? ""} onChange={(e) => set({ customerStatement: { ...(draft.customerStatement ?? {}), text: e.target.value || null } })} /></Field>
          </div>
          <p className="mt-1 text-xs text-muted">{tt("agent.form.statementNote")}</p>
        </fieldset>
      )}

      {draft.businessOutcome === "DISPUTE" && (
        <Field label={tt("agent.form.dispute")} htmlFor="dispute" required><Input id="dispute" disabled={locked} value={draft.dispute?.reason ?? ""} onChange={(e) => set({ dispute: { reason: e.target.value } })} /></Field>
      )}
      {(draft.businessOutcome === "SUPPORT_NEEDED" || draft.businessOutcome === "SPECIAL_REFERRAL") && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">{deceased ? tt("agent.form.deceased") : tt("agent.form.referral")}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={tt("agent.form.type")} htmlFor="support-type" required>
              <Select id="support-type" disabled={locked} data-testid="support-type" value={draft.support?.type ?? ""} onChange={(e) => set({ support: { reason: draft.support?.reason ?? "", type: e.target.value as NonNullable<OutcomeDraft["support"]>["type"], reporterRelation: draft.support?.reporterRelation ?? null } })}>
                <option value="">{tt("agent.form.select")}</option>
                {draft.businessOutcome === "SUPPORT_NEEDED" ? <><option value="HARDSHIP">Hardship / repayment support</option><option value="COMPLAINT">Complaint</option></> : <><option value="SPECIAL_HANDLING">Special handling</option><option value="DECEASED_LEGAL">{tt("agent.form.deceased")}</option></>}
              </Select>
            </Field>
            <Field label={tt("agent.form.reasonShort")} htmlFor="support-reason" required><Input id="support-reason" disabled={locked} value={draft.support?.reason ?? ""} onChange={(e) => set({ support: { type: draft.support?.type ?? (draft.businessOutcome === "SUPPORT_NEEDED" ? "HARDSHIP" : "SPECIAL_HANDLING"), reason: e.target.value, reporterRelation: draft.support?.reporterRelation ?? null } })} /></Field>
            {deceased && (
              <Field label={tt("agent.form.reporterRelation")} htmlFor="reporter-relation" required>
                <Select id="reporter-relation" disabled={locked} data-testid="reporter-relation" value={draft.support?.reporterRelation ?? ""} onChange={(e) => set({ support: { type: "DECEASED_LEGAL", reason: draft.support?.reason ?? "", reporterRelation: (e.target.value || null) as NonNullable<OutcomeDraft["support"]>["reporterRelation"] } })}>
                  <option value="">{tt("agent.form.select")}</option>
                  {REPORTERS.map((r) => <option key={r} value={r}>{reporterLabels[r]}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {deceased && <p className="callout callout-warning mt-2 text-xs">{tt("agent.form.deceasedNote")}</p>}
        </fieldset>
      )}

      {rpc && draft.businessOutcome && (
        <section aria-labelledby="step-flags">
          <p className="step-label" id="step-flags"><span className="step-no">+</span> {tt("agent.form.alsoNoted")}</p>
          <div className="chip-row">{FLAGS.map((k) => <button key={k} type="button" className="chip" data-testid={`flag-${k}`} aria-pressed={(draft.secondaryFlags ?? []).includes(k)} disabled={locked} onClick={() => toggleFlag(k)}>{tt(`agent.flags.${k}`)}</button>)}</div>
        </section>
      )}

      <Field label={tt("agent.form.note")} htmlFor="note" hint={draft.nonPaymentReason === "OTHER" || draft.businessOutcome === "SPECIAL_REFERRAL" || (draft.secondaryFlags ?? []).some((f) => f === "DISPUTE_RAISED" || f === "SUPPORT_REFERRAL_REQUESTED") ? tt("agent.form.noteRequired") : tt("agent.form.noteHint")}>
        <Textarea id="note" disabled={locked} value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} rows={2} />
      </Field>
      <div className="flex items-center gap-2 text-xs">
        <Badge tone={saveState === "saved" ? "info" : saveState === "error" ? "danger" : "neutral"}>{saveState === "saving" ? tt("agent.form.draftSaving") : saveState === "saved" ? tt("agent.form.draftSaved") : saveState === "error" ? tt("agent.form.draftFailed") : tt("agent.form.draft")}</Badge>
        <span className="text-muted">{tt("agent.form.draftNote")}</span>
      </div>
    </div>
  );
}
