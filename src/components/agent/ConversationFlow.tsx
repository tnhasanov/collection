"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime, bakuTodayIso, toBakuLocalInput, fromBakuLocalInput } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";
import { ot } from "@/i18n/outcomeText";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";
import {
  REASON_REQUIRED,
  allowedOutcomes,
  amountChoice,
  amountPresets,
  bindScript,
  callbackChoice,
  callbackShortcuts,
  dateChoice,
  dateShortcuts,
  isPromise,
  promiseCoverage,
  scriptValues,
  stageStatus,
  switchIdentity,
  switchOutcome,
  updatePromise,
  type Stash,
  type StageKey,
} from "@/components/agent/conversation";

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
  warnings: string[];
  derivedOutcome: string;
  coverage: "FULL" | "PARTIAL" | "NOTHING_DUE" | null;
  coveredOverdue: string | null;
  factualSummary: string;
  policyVersion: string;
}

const IDENTITY = ["RPC_VERIFIED", "THIRD_PARTY", "VERIFICATION_FAILED", "WRONG_PERSON", "WRONG_NUMBER"] as const;
const REASONS = ["SALARY_TIMING", "TEMPORARY_SHORTFALL", "INCOME_INTERRUPTION", "AFFORDABILITY", "FORGOT", "TECHNICAL_PAYMENT_ISSUE", "DISPUTED_DEBT", "OTHER", "NOT_STATED"] as const;
const FLAGS = ["SUPPORT_REFERRAL_REQUESTED", "DISPUTE_RAISED", "CONTACT_DETAILS_CHANGED", "VULNERABILITY_INDICATED"] as const;
const REPORTERS = ["SPOUSE", "CHILD", "PARENT", "SIBLING", "RELATIVE", "EMPLOYER", "LEGAL_REPRESENTATIVE", "OTHER"] as const;

/** Persists the draft (debounced, flushed on leave) and keeps the server preview current. Drafts never submit anything. */
function useDraftSync(interactionId: string, draft: OutcomeDraft, locked: boolean, onPreview: (p: PreviewResult | null) => void) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  const dirty = useRef(false);
  const key = `outcome:${interactionId}`;
  const serialized = JSON.stringify(draft);
  // The draft restored from the server is not written back; only the agent's changes are.
  const lastSaved = useRef(serialized);
  useEffect(() => {
    latest.current = draft;
    if (locked) return;
    if (serialized !== lastSaved.current) {
      dirty.current = true;
      setState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        const r = await api(`/api/agent/interactions/${interactionId}/draft`, { ...draft, idempotencyKey: key });
        if (r.ok) lastSaved.current = serialized;
        dirty.current = false;
        setState(r.ok ? "saved" : "error");
      }, 900);
    }
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      if (!draft.identityStatus || !draft.businessOutcome) return onPreview(null);
      const r = await api<PreviewResult>(`/api/agent/interactions/${interactionId}/preview`, { ...draft, idempotencyKey: key, returnReady: draft.returnReady ?? true });
      onPreview(r.ok ? r.data : null);
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, interactionId, locked]);
  useEffect(() => {
    // Leaving the page (navigation, reload) flushes an unsaved draft so the return restores exactly what was entered.
    const flush = () => {
      if (!dirty.current || locked) return;
      void fetch(`/api/agent/interactions/${interactionId}/draft`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...latest.current, idempotencyKey: key }) });
      dirty.current = false;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [interactionId, key, locked]);
  return state;
}

function Choice({ pressed, onClick, label, hint, disabled, testId }: { pressed: boolean; onClick: () => void; label: string; hint?: string; disabled?: boolean; testId?: string }) {
  return (
    <button type="button" className="choice" aria-pressed={pressed} onClick={onClick} disabled={disabled} data-testid={testId}>
      <span className="pr-4">{label}</span>
      {hint && <span className="choice-hint">{hint}</span>}
    </button>
  );
}

function Script({ text, vars, testId }: { text: string; vars: Record<string, string | null | undefined>; testId?: string }) {
  return (
    <p className="script-passage" data-testid={testId}>
      {bindScript(text, vars).map((seg, i) =>
        seg.variable ? (
          <span key={i} className={seg.missing ? "script-var-missing" : "script-var"} data-var={seg.variable}>
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

function Stage({ n, title, state, summary, onOpen, children, testId, locale, editable = true }: { n: number; title: string; state: "current" | "done" | "todo"; summary?: string | null; onOpen: () => void; children?: React.ReactNode; testId: string; locale: Locale; editable?: boolean }) {
  const open = !!children;
  return (
    <section className="stage" data-state={open ? "current" : state} data-testid={testId} aria-label={title}>
      <div className="stage-head">
        <span className="stage-no" aria-hidden="true">{state === "done" && !open ? "✓" : n}</span>
        <span className="text-base font-semibold text-ink">{title}</span>
        {!open && summary && <span className="min-w-0 flex-1 truncate text-sm text-muted">· {summary}</span>}
        {!open && state !== "todo" && editable && (
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onOpen} data-testid={`${testId}-edit`}>
            {at(locale, "conv.change")}
          </button>
        )}
      </div>
      {open && <div className="stage-body">{children}</div>}
    </section>
  );
}

/**
 * One conversation: Identity → Reason and discussion → Outcome and confirmation. Each stage shows the script passage
 * and the answers that belong to it; finished stages collapse into an editable summary. Identity determines what may
 * be disclosed and which outcomes exist; nothing (identity, reason, intent, consent) is ever preselected.
 */
export function ConversationFlow({ ctx, locale, draft, onChange, onPreview, serverNow, agentName, active }: { ctx: AgentContext; locale: Locale; draft: OutcomeDraft; onChange: (d: OutcomeDraft) => void; onPreview: (p: PreviewResult | null) => void; serverNow: () => Date; agentName: string; active: boolean }) {
  const A = (k: string, v?: Record<string, string | number>) => at(locale, k, v);
  const T = (k: string) => t(locale, k);
  const interaction = ctx.interaction;
  const customer = ctx.customer;
  const script = ctx.script;
  const locked = !interaction || interaction.status === "SAVED" || interaction.status === "CORRECTED" || !active;
  const saveState = useDraftSync(interaction?.id ?? "none", draft, locked || !interaction, onPreview);
  const stash = useRef<Stash>({ outcomes: {} });
  const [openStage, setOpenStage] = useState<StageKey | null>(null);
  const [customAmount, setCustomAmount] = useState(false);
  const [customDate, setCustomDate] = useState(false);
  const [customCallback, setCustomCallback] = useState(false);
  const [cbPicked, setCbPicked] = useState<{ key: string; dueAt: string } | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [consentReset, setConsentReset] = useState(false);
  const [outcomeListOpen, setOutcomeListOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  const loans = useMemo(() => customer?.loans.filter((l) => l.status === "ACTIVE") ?? [], [customer]);
  const overdueLoans = loans.filter((l) => Number(l.totalOverdue) > 0);
  const overdueTotal = overdueLoans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2);
  const overdueCleared = !!customer && Number(customer.summary.overdueDueNow) <= 0;
  const defaultLoans = (overdueLoans.length ? overdueLoans : loans).map((l) => l.id);
  const presets = amountPresets(overdueTotal, customer?.summary.nextDue?.amount ?? null);
  const today = bakuTodayIso(ctx.serverNow);
  const maxDate = ctx.promisePolicy?.maxDate ?? null;
  const shortcuts = dateShortcuts(today, maxDate);
  const skipped = !!draft.ui?.reasonSkipped;
  const status = stageStatus(draft, skipped);
  const current: StageKey = openStage ?? status.current;
  const rpc = draft.identityStatus === "RPC_VERIFIED";
  const thirdParty = draft.identityStatus === "THIRD_PARTY";
  const promise = isPromise(draft.businessOutcome);
  const fmtD = (iso: string) => fmtDate(iso, locale);
  const values = scriptValues(draft, fmtD);
  const overdueLoan = [...overdueLoans].sort((a, b) => ((a.oldestUnpaidDueDate ?? "") < (b.oldestUnpaidDueDate ?? "") ? -1 : 1))[0];
  const vars: Record<string, string | null> = {
    agentName,
    customerName: customer?.customer.displayName ?? "",
    overdueAmount: fmtAzn(customer?.summary.overdueDueNow ?? "0", false),
    oldestDueDate: overdueLoan?.oldestUnpaidDueDate ? fmtD(overdueLoan.oldestUnpaidDueDate) : "—",
    dpd: String(customer?.summary.maxDpd ?? 0),
    promiseAmount: values.promiseAmount,
    promiseDate: values.promiseDate,
  };
  const steps = new Map((script?.body.steps ?? []).map((s) => [s.key, s]));
  const stepText = (k: string) => steps.get(k)?.text ?? null;
  const set = (next: OutcomeDraft) => {
    if (!locked) onChange(next);
  };
  const go = (s: StageKey | null) => setOpenStage(s);
  const amountSel = amountChoice(draft, presets, customAmount);
  const dateSel = dateChoice(draft, shortcuts, customDate);
  const cbShortcuts = callbackShortcuts(serverNow().getTime(), (d) => bakuTodayIso(d.toISOString()), fromBakuLocalInput);
  const cbSel = cbPicked && cbPicked.dueAt === draft.callback?.dueAt && !customCallback ? cbPicked.key : callbackChoice(draft, cbShortcuts, customCallback);
  const setCallback = (patch: Partial<NonNullable<OutcomeDraft["callback"]>>) => set({ ...draft, callback: { dueAt: draft.callback?.dueAt ?? "", customerRequested: draft.callback?.customerRequested ?? true, ownerMode: draft.callback?.ownerMode ?? "ME", ...patch } });
  const coverage = customer ? promiseCoverage(draft, loans) : null;
  const owedFor = (ids: string[]) => loans.filter((l) => ids.includes(l.id)).reduce((s, l) => s + Number(l.principalOutstanding) + Number(l.overdueInterest) + Number(l.feesDue) + Number(l.accruedInterestNotDue), 0);
  const maxOwed = owedFor(draft.ptp?.coveredLoanIds ?? defaultLoans);
  const beyondHorizon = !!draft.ptp?.deadlineDate && !!maxDate && draft.ptp.deadlineDate > maxDate;
  const noteRequired = draft.nonPaymentReason === "OTHER" || draft.businessOutcome === "SPECIAL_REFERRAL" || (draft.secondaryFlags ?? []).some((f) => f === "DISPUTE_RAISED" || f === "SUPPORT_REFERRAL_REQUESTED");
  const ptp = draft.ptp;
  // Changing the amount, date or loans after the customer agreed clears the agreement and says so.
  const setPromise = (patch: Partial<NonNullable<OutcomeDraft["ptp"]>>) => {
    const next = updatePromise(draft, patch, defaultLoans);
    if (draft.ptp?.customerConfirmed && !next.ptp?.customerConfirmed && patch.customerConfirmed === undefined) setConsentReset(true);
    if (next.ptp?.customerConfirmed) setConsentReset(false);
    set(next);
  };
  const showConsentReset = consentReset && !!ptp && !ptp.customerConfirmed;

  // Stage summaries (collapsed, editable).
  const identitySummary = draft.identityStatus ? t(locale, `agent.identity.${draft.identityStatus}`) : null;
  const reasonSummary = draft.nonPaymentReason ? t(locale, `agent.reasons.${draft.nonPaymentReason}`) : skipped || draft.businessOutcome ? "—" : null;
  const outcomeSummary = draft.businessOutcome ? [t(locale, `agent.outcomes.${draft.businessOutcome}`), promise && ptp?.amount ? `${fmtAzn(ptp.amount)}` : null, promise && ptp?.deadlineDate ? fmtD(ptp.deadlineDate) : null].filter(Boolean).join(" · ") : null;

  if (!interaction || !customer) return null;
  const outcomeOptions = rpc ? allowedOutcomes("RPC_VERIFIED", overdueCleared) : thirdParty ? allowedOutcomes("THIRD_PARTY") : [];

  return (
    <div className="space-y-0" data-testid="conversation">
      {!active && <p className="callout callout-info mb-3 text-sm">{A("conv.waitConnect")}</p>}

      <Stage n={1} title={A("conv.identity")} state={status.identityDone ? "done" : "current"} summary={identitySummary} onOpen={() => go("identity")} testId="stage-identity" locale={locale}>
        {current === "identity" ? (
          <>
            {stepText("verify") && <Script text={stepText("verify")!} vars={vars} testId="script-verify" />}
            <div className="choice-grid" role="group" aria-label={A("conv.identity")}>
              {IDENTITY.map((k) => (
                <Choice
                  key={k}
                  testId={`identity-${k}`}
                  pressed={draft.identityStatus === k}
                  disabled={locked}
                  label={t(locale, `agent.identity.${k}`)}
                  hint={t(locale, `agent.identityHint.${k}`)}
                  onClick={() => {
                    if (draft.identityStatus !== k) set(switchIdentity(draft, k, stash.current, overdueCleared));
                    if (k !== "WRONG_NUMBER") go(null);
                  }}
                />
              ))}
            </div>
            {draft.identityStatus === "WRONG_NUMBER" && (
              <Field label={T("agent.form.wrongCp")} htmlFor="wrong-cp" required>
                <Select id="wrong-cp" value={draft.wrongNumber?.contactPointId ?? ""} disabled={locked} onChange={(e) => { set({ ...draft, wrongNumber: e.target.value ? { contactPointId: e.target.value } : null }); if (e.target.value) go(null); }}>
                  <option value="">{T("agent.form.select")}</option>
                  {customer.contacts.map((c) => <option key={c.id} value={c.id}>{c.type} {c.value}</option>)}
                </Select>
              </Field>
            )}
          </>
        ) : null}
      </Stage>

      <Stage n={2} title={A("conv.discussion")} state={status.identityDone && status.discussionDone ? "done" : status.identityDone ? "current" : "todo"} summary={status.identityDone && !status.discussionApplies ? A("conv.notApplicable") : reasonSummary} editable={status.discussionApplies} onOpen={() => go("discussion")} testId="stage-discussion" locale={locale}>
        {current === "discussion" && status.discussionApplies ? (
          <>
            {stepText("explain") && <Script text={stepText("explain")!} vars={vars} testId="script-explain" />}
            <div>
              <span className="field-label">{T("agent.form.reason")}</span>
              <div className="chip-row" role="group">
                {REASONS.map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={draft.nonPaymentReason === k} data-testid={`reason-${k}`} disabled={locked} onClick={() => { set({ ...draft, nonPaymentReason: draft.nonPaymentReason === k ? null : k }); if (draft.nonPaymentReason !== k) go(null); }}>
                    {t(locale, `agent.reasons.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            {!draft.nonPaymentReason && (
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => { set({ ...draft, ui: { ...(draft.ui ?? {}), reasonSkipped: true } }); go(null); }} data-testid="skip-reason">
                {A("conv.skipReason")}
              </Button>
            )}
          </>
        ) : null}
      </Stage>

      <Stage n={3} title={A("conv.outcome")} state={status.outcomeDone ? "done" : status.identityDone && status.discussionDone ? "current" : "todo"} summary={outcomeSummary} onOpen={() => go("outcome")} testId="stage-outcome" locale={locale}>
        {current === "outcome" && status.identityDone ? (
          <>
            {thirdParty && script?.body.thirdParty && <Script text={script.body.thirdParty} vars={vars} testId="script-third-party" />}
            {rpc && stepText("agree") && !promise && <Script text={stepText("agree")!} vars={vars} testId="script-agree" />}
            {rpc && overdueCleared && <p className="callout callout-success text-sm" data-testid="overdue-cleared-hint">{T("agent.form.closedNote")}</p>}
            {rpc && overdueCleared && promise && <p className="callout callout-warning text-sm" data-testid="ptp-obsolete">{A("conv.ptpObsolete")}</p>}
            {outcomeOptions.length > 0 && draft.businessOutcome && !outcomeListOpen ? (
              <div className="flex flex-wrap items-center gap-3" data-testid="outcome-chosen">
                <span className="choice max-w-sm" aria-pressed="true">
                  <span className="pr-4">{t(locale, `agent.outcomes.${draft.businessOutcome}`)}</span>
                </span>
                {!locked && outcomeOptions.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOutcomeListOpen(true)} data-testid="outcome-change">
                    {A("conv.change")}
                  </button>
                )}
              </div>
            ) : outcomeOptions.length > 0 ? (
              <div className="choice-grid" role="group" aria-label={A("conv.outcome")}>
                {outcomeOptions.map((k) => (
                  <Choice
                    key={k}
                    testId={`outcome-${k}`}
                    pressed={draft.businessOutcome === k || (k === "PTP" && draft.businessOutcome === "PARTIAL_COMMITMENT")}
                    disabled={locked || (overdueCleared && k === "PTP")}
                    label={t(locale, `agent.outcomes.${k}`)}
                    hint={overdueCleared && k === "PTP" ? A("conv.ptpUnavailable") : t(locale, `agent.outcomeHints.${k}`)}
                    onClick={() => { if (draft.businessOutcome !== k) set(switchOutcome(draft, k, stash.current)); setOutcomeListOpen(false); }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">{T("agent.form.noConversation")}</p>
            )}

            {promise && (
              <div className="space-y-4 rounded-lg border border-line p-4" data-testid="promise-fields">
                <div>
                  <span className="field-label">{T("agent.form.amount")}</span>
                  <div className="chip-row">
                    {presets.map((p) => (
                      <button key={p.key} type="button" className="chip tabular-nums" data-testid={p.key === "overdue" ? "ptp-amount-overdue" : "ptp-amount-installment"} aria-pressed={amountSel === p.key} disabled={locked} onClick={() => { setCustomAmount(false); setPromise({ amount: p.amount }); }}>
                        {p.key === "overdue" ? T("agent.form.overdueNow") : T("agent.form.nextInstallment")} · {fmtAzn(p.amount, false)}
                      </button>
                    ))}
                    <button type="button" className="chip" aria-pressed={amountSel === "custom"} disabled={locked} onClick={() => setCustomAmount(true)} data-testid="ptp-amount-other">
                      {T("agent.form.otherAmount")}
                    </button>
                  </div>
                  {amountSel === "custom" && (
                    <div className="mt-2 flex items-center gap-2">
                      <Input id="ptp-amount" aria-label={T("agent.form.amount")} className="input max-w-40 tabular-nums" inputMode="decimal" value={ptp?.amount ?? ""} disabled={locked} onChange={(e) => setPromise({ amount: e.target.value.replace(",", ".") })} data-testid="ptp-amount-input" />
                      <span className="text-sm text-muted">AZN · {A("conv.maxAmount", { max: maxOwed.toFixed(2) })}</span>
                    </div>
                  )}
                </div>
                <div>
                  <span className="field-label">{T("agent.form.deadline")}</span>
                  <div className="chip-row">
                    {shortcuts.map((s) => (
                      <button key={s.key} type="button" className="chip" data-testid={`ptp-date-${s.key === "today" ? "Today" : s.key === "plus3" ? "3days" : "7days"}`} aria-pressed={dateSel === s.key} disabled={locked} onClick={() => { setCustomDate(false); setPromise({ deadlineDate: s.date }); }}>
                        {T(`agent.form.${s.key === "today" ? "today" : s.key === "plus3" ? "plus3" : "plus7"}`)} · {fmtD(s.date)}
                      </button>
                    ))}
                    <button type="button" className="chip" aria-pressed={dateSel === "custom"} disabled={locked} onClick={() => setCustomDate(true)} data-testid="ptp-date-other">
                      {T("agent.form.otherDate")}
                    </button>
                  </div>
                  {dateSel === "custom" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input id="ptp-date" aria-label={T("agent.form.deadline")} type="date" className="input max-w-48" min={today} max={draft.businessOutcome === "PTP_EXCEPTION_PROPOSED" ? undefined : maxDate ?? undefined} value={ptp?.deadlineDate ?? ""} disabled={locked} onChange={(e) => setPromise({ deadlineDate: e.target.value })} data-testid="ptp-date-input" />
                      {maxDate && <span className="text-sm text-muted">{A("conv.maxDate", { date: fmtD(maxDate) })}</span>}
                    </div>
                  )}
                </div>
                {loans.length > 1 && (
                  <div>
                    <span className="field-label">{A("conv.selectedLoans")}</span>
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {loans.map((l) => (
                        <label key={l.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
                          <input type="checkbox" className="h-4 w-4" checked={(ptp?.coveredLoanIds ?? defaultLoans).includes(l.id)} disabled={locked} onChange={(e) => { const cur = new Set(ptp?.coveredLoanIds ?? defaultLoans); if (e.target.checked) cur.add(l.id); else cur.delete(l.id); setPromise({ coveredLoanIds: [...cur] }); }} />
                          {l.coreLoanId} · {fmtAzn(l.totalOverdue)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {coverage && coverage.covered > 0 && (
                  <p className={`text-sm ${coverage.partial ? "text-warning" : "text-success"}`} data-testid="promise-coverage">
                    {coverage.partial ? A("conv.partial", { amount: coverage.amount.toFixed(2), covered: coverage.covered.toFixed(2), rest: coverage.rest.toFixed(2) }) : A("conv.full")}
                  </p>
                )}
                {draft.businessOutcome !== "PTP_EXCEPTION_PROPOSED" && beyondHorizon && ctx.promisePolicy && (
                  <div className="callout callout-warning text-sm" data-testid="horizon-warning">
                    <p>{T("agent.form.horizon").replace("{days}", String(ctx.promisePolicy.maxHorizonDays)).replace("{max}", fmtD(ctx.promisePolicy.maxDate))}</p>
                    <Button size="sm" className="mt-2" disabled={locked} onClick={() => set({ ...draft, businessOutcome: "PTP_EXCEPTION_PROPOSED" })} data-testid="to-exception">
                      {T("agent.form.toException")}
                    </Button>
                  </div>
                )}
                {draft.businessOutcome === "PTP_EXCEPTION_PROPOSED" && <p className="callout callout-info text-sm" data-testid="exception-note">{T("agent.form.exceptionNote")}</p>}
                {stepText("confirm") && <Script text={stepText("confirm")!} vars={vars} testId="script-confirm" />}
                <label className="flex min-h-10 items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm font-medium">
                  <input type="checkbox" className="h-5 w-5" data-testid="ptp-confirm" checked={!!ptp?.customerConfirmed} disabled={locked || !ptp?.amount || !ptp?.deadlineDate} onChange={(e) => setPromise({ customerConfirmed: e.target.checked })} />
                  {T("agent.form.confirm")}
                </label>
                {showConsentReset && <p className="text-sm text-warning" data-testid="consent-reset">{A("conv.consentReset")}</p>}
              </div>
            )}

            {draft.businessOutcome === "CALLBACK_REQUESTED" && (
              <div className="space-y-3 rounded-lg border border-line p-4" data-testid="callback-fields">
                <span className="field-label">{T("agent.form.agreedTime")}</span>
                <div className="chip-row">
                  {cbShortcuts.map((s) => (
                    <button key={s.key} type="button" className="chip" data-testid={s.key === "tomorrow10" ? "cb-time-tomorrow-10" : s.key === "tomorrow18" ? "cb-time-tomorrow-18" : "cb-time-plus2h"} aria-pressed={cbSel === s.key} disabled={locked} onClick={() => { setCustomCallback(false); setCbPicked(s); setCallback({ dueAt: s.dueAt }); }}>
                      {A(s.key === "tomorrow10" ? "conv.cbTomorrow10" : s.key === "tomorrow18" ? "conv.cbTomorrow18" : "conv.cb2h")}
                    </button>
                  ))}
                  <button type="button" className="chip" aria-pressed={cbSel === "custom"} disabled={locked} onClick={() => setCustomCallback(true)} data-testid="cb-time-other">
                    {A("conv.otherTime")}
                  </button>
                </div>
                {cbSel === "custom" && (
                  <Input id="cb-time" aria-label={T("agent.form.agreedTime")} className="input max-w-60" type="datetime-local" disabled={locked} value={toBakuLocalInput(draft.callback?.dueAt ?? null)} onChange={(e) => setCallback({ dueAt: fromBakuLocalInput(e.target.value) ?? "" })} data-testid="cb-time-input" />
                )}
                {draft.callback?.dueAt && <p className="text-sm text-ink" data-testid="cb-time-value">{fmtDateTime(draft.callback.dueAt, false, locale)}</p>}
                <div className="flex flex-wrap items-center gap-4">
                  <Select aria-label={T("common.owner")} className="select w-auto" disabled={locked || !draft.callback?.dueAt} value={draft.callback?.ownerMode ?? "ME"} onChange={(e) => setCallback({ ownerMode: e.target.value as "ME" | "POOL" })}>
                    <option value="ME">{T("agent.form.ownerMe")}</option>
                    <option value="POOL">{T("agent.form.ownerPool")}</option>
                  </Select>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" disabled={locked || !draft.callback?.dueAt} checked={draft.callback?.customerRequested ?? true} onChange={(e) => setCallback({ customerRequested: e.target.checked })} />
                    {T("agent.form.customerRequested")}
                  </label>
                </div>
              </div>
            )}

            {draft.businessOutcome === "ALREADY_PAID_CLAIM" && (
              <div className="space-y-3 rounded-lg border border-line p-4" data-testid="claim-fields">
                <p className="text-sm text-muted">{T("agent.form.claimNote")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={T("agent.form.amount")} htmlFor="claim-amount"><Input id="claim-amount" inputMode="decimal" disabled={locked} value={draft.paidClaim?.amount ?? ""} onChange={(e) => set({ ...draft, paidClaim: { ...(draft.paidClaim ?? {}), amount: e.target.value || null } })} /></Field>
                  <Field label={T("common.date")} htmlFor="claim-date"><Input id="claim-date" type="date" max={today} disabled={locked} value={draft.paidClaim?.date ?? ""} onChange={(e) => set({ ...draft, paidClaim: { ...(draft.paidClaim ?? {}), date: e.target.value || null } })} /></Field>
                  <Field label={A("conv.channel")} htmlFor="claim-channel"><Input id="claim-channel" disabled={locked} value={draft.paidClaim?.channel ?? ""} onChange={(e) => set({ ...draft, paidClaim: { ...(draft.paidClaim ?? {}), channel: e.target.value || null } })} /></Field>
                  <Field label={A("conv.reference")} htmlFor="claim-ref"><Input id="claim-ref" disabled={locked} value={draft.paidClaim?.reference ?? ""} onChange={(e) => set({ ...draft, paidClaim: { ...(draft.paidClaim ?? {}), reference: e.target.value || null } })} /></Field>
                </div>
                {!draft.paidClaim && <button type="button" className="chip" data-testid="claim-unknown" disabled={locked} onClick={() => set({ ...draft, paidClaim: {} })}>{T("agent.form.claimUnknown")}</button>}
              </div>
            )}

            {draft.businessOutcome === "DISPUTE" && (
              <Field label={T("agent.form.dispute")} htmlFor="dispute" required>
                <Input id="dispute" disabled={locked} value={draft.dispute?.reason ?? ""} onChange={(e) => set({ ...draft, dispute: { reason: e.target.value } })} />
              </Field>
            )}

            {(draft.businessOutcome === "SUPPORT_NEEDED" || draft.businessOutcome === "SPECIAL_REFERRAL") && (
              <div className="space-y-3 rounded-lg border border-line p-4" data-testid="referral-fields">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={T("agent.form.type")} htmlFor="support-type" required>
                    <Select id="support-type" data-testid="support-type" disabled={locked} value={draft.support?.type ?? ""} onChange={(e) => set({ ...draft, support: { reason: draft.support?.reason ?? "", type: e.target.value as NonNullable<OutcomeDraft["support"]>["type"], reporterRelation: draft.support?.reporterRelation ?? null } })}>
                      <option value="">{T("agent.form.select")}</option>
                      {draft.businessOutcome === "SUPPORT_NEEDED" ? (
                        <>
                          <option value="HARDSHIP">{ot(locale, "st.HARDSHIP")}</option>
                          <option value="COMPLAINT">{ot(locale, "st.COMPLAINT")}</option>
                        </>
                      ) : (
                        <>
                          <option value="SPECIAL_HANDLING">{ot(locale, "st.SPECIAL_HANDLING")}</option>
                          <option value="DECEASED_LEGAL">{T("agent.form.deceased")}</option>
                        </>
                      )}
                    </Select>
                  </Field>
                  <Field label={T("agent.form.reasonShort")} htmlFor="support-reason" required>
                    <Input id="support-reason" disabled={locked} value={draft.support?.reason ?? ""} onChange={(e) => set({ ...draft, support: { type: draft.support?.type ?? (draft.businessOutcome === "SUPPORT_NEEDED" ? "HARDSHIP" : "SPECIAL_HANDLING"), reason: e.target.value, reporterRelation: draft.support?.reporterRelation ?? null } })} />
                  </Field>
                  {draft.support?.type === "DECEASED_LEGAL" && (
                    <Field label={T("agent.form.reporterRelation")} htmlFor="reporter-relation" required>
                      <Select id="reporter-relation" data-testid="reporter-relation" disabled={locked} value={draft.support?.reporterRelation ?? ""} onChange={(e) => set({ ...draft, support: { type: "DECEASED_LEGAL", reason: draft.support?.reason ?? "", reporterRelation: (e.target.value || null) as NonNullable<OutcomeDraft["support"]>["reporterRelation"] } })}>
                        <option value="">{T("agent.form.select")}</option>
                        {REPORTERS.map((r) => <option key={r} value={r}>{ot(locale, `rel.${r}`)}</option>)}
                      </Select>
                    </Field>
                  )}
                </div>
                {draft.support?.type === "DECEASED_LEGAL" && <p className="callout callout-warning text-sm">{T("agent.form.deceasedNote")}</p>}
              </div>
            )}

            {rpc && ["NO_COMMITMENT", "REFUSED", "CALLBACK_REQUESTED"].includes(draft.businessOutcome ?? "") && (
              <details className="rounded-lg border border-line px-4 py-2" open={statementOpen || !!draft.customerStatement} onToggle={(e) => setStatementOpen((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer py-1 text-sm font-medium">{T("agent.form.statement")}</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <Field label={T("common.date")} htmlFor="stmt-date"><Input id="stmt-date" type="date" disabled={locked} value={draft.customerStatement?.indicativePaymentDate ?? ""} onChange={(e) => set({ ...draft, customerStatement: { ...(draft.customerStatement ?? {}), indicativePaymentDate: e.target.value || null } })} /></Field>
                  <Field label={T("agent.form.amount")} htmlFor="stmt-amount"><Input id="stmt-amount" inputMode="decimal" disabled={locked} value={draft.customerStatement?.indicativeAmount ?? ""} onChange={(e) => set({ ...draft, customerStatement: { ...(draft.customerStatement ?? {}), indicativeAmount: e.target.value || null } })} /></Field>
                  <Field label={T("agent.form.note")} htmlFor="stmt-text"><Input id="stmt-text" disabled={locked} value={draft.customerStatement?.text ?? ""} onChange={(e) => set({ ...draft, customerStatement: { ...(draft.customerStatement ?? {}), text: e.target.value || null } })} /></Field>
                </div>
                <p className="hint">{T("agent.form.statementNote")}</p>
              </details>
            )}

            {rpc && draft.businessOutcome && stepText("close") && <Script text={stepText("close")!} vars={vars} testId="script-close" />}

            {rpc && draft.businessOutcome && (
              <details className="rounded-lg border border-line px-4 py-2" data-testid="facts">
                <summary className="cursor-pointer py-1 text-sm font-medium">
                  {A("conv.facts")}
                  {(draft.secondaryFlags ?? []).length > 0 && <span className="ml-2 text-muted">({(draft.secondaryFlags ?? []).length})</span>}
                </summary>
                <div className="chip-row mt-2">
                  {FLAGS.map((k) => (
                    <button key={k} type="button" className="chip" data-testid={`flag-${k}`} aria-pressed={(draft.secondaryFlags ?? []).includes(k)} disabled={locked} onClick={() => { const cur = new Set(draft.secondaryFlags ?? []); if (cur.has(k)) cur.delete(k); else cur.add(k); set({ ...draft, secondaryFlags: [...cur] }); }}>
                      {t(locale, `agent.flags.${k}`)}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : null}
      </Stage>

      {status.identityDone && (
        <div className="mt-3">
          {noteRequired || noteOpen || draft.note ? (
            <Field label={`${T("agent.form.note")}${noteRequired ? ` · ${A("conv.noteRequired")}` : ""}`} htmlFor="note" required={noteRequired}>
              <Textarea id="note" rows={2} disabled={locked} value={draft.note ?? ""} onChange={(e) => set({ ...draft, note: e.target.value })} />
            </Field>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNoteOpen(true)} disabled={locked} data-testid="add-note">
              + {A("conv.addNote")}
            </button>
          )}
          {!locked && rpc && draft.businessOutcome && REASON_REQUIRED.includes(draft.businessOutcome) && !draft.nonPaymentReason && (
            <p className="mt-2 text-sm text-warning">
              {T("agent.form.reasonRequired")}{" "}
              <button type="button" className="underline" onClick={() => go("discussion")}>
                {A("conv.change")}
              </button>
            </p>
          )}
          <p className="mt-2 text-xs text-muted" aria-live="polite" data-testid="draft-state">
            {saveState === "saving" ? T("agent.form.draftSaving") : saveState === "saved" ? T("agent.form.draftSaved") : saveState === "error" ? T("agent.form.draftFailed") : ""}
          </p>
        </div>
      )}
    </div>
  );
}
