"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";
import { fmtAzn, fmtDate, bakuTodayIso, toBakuLocalInput, fromBakuLocalInput } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api } from "@/components/agent/useAgentStream";

const IDENTITY = [
  ["RPC_VERIFIED", "Right party verified"],
  ["THIRD_PARTY", "Third party answered"],
  ["VERIFICATION_FAILED", "Verification failed"],
  ["WRONG_PERSON", "Wrong person"],
  ["WRONG_NUMBER", "Wrong number"],
  ["NOT_ESTABLISHED", "Not established"],
] as const;
const OUTCOMES = [
  ["PTP", "Promise to pay"],
  ["PARTIAL_COMMITMENT", "Partial-payment commitment"],
  ["NO_COMMITMENT", "No commitment"],
  ["CALLBACK_REQUESTED", "Customer-requested callback"],
  ["ALREADY_PAID_CLAIM", "Already-paid claim"],
  ["DISPUTE", "Dispute"],
  ["SUPPORT_NEEDED", "Repayment support needed"],
  ["REFUSED", "Refused to discuss"],
  ["SPECIAL_REFERRAL", "Special-case referral"],
  ["NO_CONVERSATION", "No conversation"],
] as const;
const REASONS = [
  ["SALARY_TIMING", "Salary timing"],
  ["TEMPORARY_SHORTFALL", "Temporary cash shortfall"],
  ["INCOME_INTERRUPTION", "Income interruption"],
  ["AFFORDABILITY", "Affordability difficulty"],
  ["FORGOT", "Forgot"],
  ["TECHNICAL_PAYMENT_ISSUE", "Technical payment issue"],
  ["DISPUTED_DEBT", "Disputed debt"],
  ["OTHER", "Other"],
  ["NOT_STATED", "Not stated"],
] as const;

export function allowedOutcomes(identity: string | undefined): string[] {
  if (identity === "RPC_VERIFIED") return OUTCOMES.map((o) => o[0]).filter((o) => o !== "NO_CONVERSATION");
  if (identity === "THIRD_PARTY") return ["NO_CONVERSATION", "SPECIAL_REFERRAL"];
  return ["NO_CONVERSATION"];
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
}

export function OutcomeForm({ ctx, draft, onChange, onPreview, compact, serverNow }: { ctx: AgentContext; draft: OutcomeDraft; onChange: (d: OutcomeDraft) => void; onPreview: (p: PreviewResult | null) => void; compact?: boolean; serverNow: () => Date }) {
  const interaction = ctx.interaction!;
  const customer = ctx.customer;
  const overdueLoans = useMemo(() => (customer?.loans ?? []).filter((l) => Number(l.totalOverdue) > 0), [customer]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idKey = useRef<string | null>(null);

  const set = (patch: Partial<OutcomeDraft>) => {
    setSaveState("saving");
    const next = { ...draft, ...patch };
    if (patch.identityStatus && !allowedOutcomes(patch.identityStatus).includes(next.businessOutcome ?? "")) next.businessOutcome = allowedOutcomes(patch.identityStatus)[0];
    onChange(next);
  };

  // Auto-save a recoverable draft to the backend (debounced) and refresh the next-action preview.
  useEffect(() => {
    if (interaction.status === "SAVED" || interaction.status === "CORRECTED") return;
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
    }, 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(draft), interaction.id]);

  const rpc = draft.identityStatus === "RPC_VERIFIED";
  const outcomes = allowedOutcomes(draft.identityStatus);
  const today = bakuTodayIso(ctx.serverNow);
  const showReason = rpc && ["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED", "ALREADY_PAID_CLAIM", "DISPUTE"].includes(draft.businessOutcome ?? "");
  const defaultPtp = () => ({ amount: overdueLoans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2), deadlineDate: today, coveredLoanIds: overdueLoans.map((l) => l.id), customerConfirmed: false });

  return (
    <div className={compact ? "space-y-2" : "grid gap-3 md:grid-cols-2"}>
      <Field label="Identity / contact status" htmlFor="identity" required>
        <Select id="identity" value={draft.identityStatus ?? ""} onChange={(e) => set({ identityStatus: e.target.value })}>
          <option value="">Select…</option>
          {IDENTITY.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Primary business outcome" htmlFor="outcome" required hint={rpc ? undefined : "Without a verified right party only 'No conversation' (or a special-case referral from a third party) can be recorded."}>
        <Select id="outcome" value={draft.businessOutcome ?? ""} onChange={(e) => set({ businessOutcome: e.target.value })} disabled={!draft.identityStatus}>
          <option value="">Select…</option>
          {OUTCOMES.filter((o) => outcomes.includes(o[0])).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      {showReason && (
        <Field label="Reason for nonpayment" htmlFor="reason" required={["PTP", "PARTIAL_COMMITMENT", "NO_COMMITMENT", "CALLBACK_REQUESTED", "REFUSED", "SUPPORT_NEEDED"].includes(draft.businessOutcome ?? "")}>
          <Select id="reason" value={draft.nonPaymentReason ?? ""} onChange={(e) => set({ nonPaymentReason: e.target.value || null })}>
            <option value="">Select…</option>
            {REASONS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {(draft.businessOutcome === "PTP" || draft.businessOutcome === "PARTIAL_COMMITMENT") && (
        <fieldset className="col-span-full rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Promise details</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Promised amount (AZN)" htmlFor="ptp-amount" required>
              <Input id="ptp-amount" inputMode="decimal" value={draft.ptp?.amount ?? ""} onChange={(e) => set({ ptp: { ...(draft.ptp ?? defaultPtp()), amount: e.target.value } })} onFocus={() => !draft.ptp && set({ ptp: defaultPtp() })} />
            </Field>
            <Field label="Payment deadline (Baku, end of day)" htmlFor="ptp-date" required>
              <Input id="ptp-date" type="date" min={today} value={draft.ptp?.deadlineDate ?? ""} onChange={(e) => set({ ptp: { ...(draft.ptp ?? defaultPtp()), deadlineDate: e.target.value } })} onFocus={() => !draft.ptp && set({ ptp: defaultPtp() })} />
            </Field>
            <div className="col-span-full">
              <p className="label">Covered obligation(s)</p>
              {overdueLoans.length === 0 && <p className="text-xs text-muted">No overdue loan; a promise can still cover the next installment.</p>}
              {(customer?.loans ?? []).map((l) => (
                <label key={l.id} className="mr-4 inline-flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={(draft.ptp?.coveredLoanIds ?? overdueLoans.map((x) => x.id)).includes(l.id)} onChange={(e) => {
                    const cur = new Set(draft.ptp?.coveredLoanIds ?? overdueLoans.map((x) => x.id));
                    if (e.target.checked) cur.add(l.id);
                    else cur.delete(l.id);
                    set({ ptp: { ...(draft.ptp ?? defaultPtp()), coveredLoanIds: [...cur] } });
                  }} />
                  {l.coreLoanId} · overdue {fmtAzn(l.totalOverdue)} {l.oldestUnpaidDueDate ? `(oldest due ${fmtDate(l.oldestUnpaidDueDate)})` : ""}
                </label>
              ))}
            </div>
            <label className="col-span-full inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft.ptp?.customerConfirmed} onChange={(e) => set({ ptp: { ...(draft.ptp ?? defaultPtp()), customerConfirmed: e.target.checked } })} />
              Customer explicitly confirmed the amount and date (an installment commitment does not rewrite the contract)
            </label>
            <p className="col-span-full text-xs text-muted">Reminder plan: PTP reminder SMS one day before the deadline under the approved template and SMS limits. Qualifying window: creation → deadline + settlement allowance.</p>
          </div>
        </fieldset>
      )}
      {draft.businessOutcome === "CALLBACK_REQUESTED" && (
        <fieldset className="col-span-full rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Callback</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Requested time (Asia/Baku)" htmlFor="cb-time" required hint="Policy re-checks eligibility at dispatch; outside permitted hours the next permitted time is used.">
              <Input id="cb-time" type="datetime-local" value={toBakuLocalInput(draft.callback?.dueAt ?? null) || toBakuLocalInput(new Date(serverNow().getTime() + 24 * 3600000).toISOString())} onChange={(e) => set({ callback: { customerRequested: true, ownerMode: "ME", ...(draft.callback ?? {}), dueAt: fromBakuLocalInput(e.target.value) ?? "" } })} />
            </Field>
            <Field label="Owner" htmlFor="cb-owner">
              <Select id="cb-owner" value={draft.callback?.ownerMode ?? "ME"} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? new Date(serverNow().getTime() + 24 * 3600000).toISOString(), customerRequested: draft.callback?.customerRequested ?? true, ownerMode: e.target.value as "ME" | "POOL" } })}>
                <option value="ME">Me (named owner, pool fallback if unavailable)</option>
                <option value="POOL">Eligible pool</option>
              </Select>
            </Field>
            <label className="col-span-full inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.callback?.customerRequested ?? true} onChange={(e) => set({ callback: { dueAt: draft.callback?.dueAt ?? new Date(serverNow().getTime() + 24 * 3600000).toISOString(), ownerMode: draft.callback?.ownerMode ?? "ME", customerRequested: e.target.checked } })} />
              Requested by the customer (narrow, evidenced exception to the cooldown under policy)
            </label>
          </div>
        </fieldset>
      )}
      {draft.businessOutcome === "ALREADY_PAID_CLAIM" && (
        <fieldset className="col-span-full rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Claimed payment (not a posting)</legend>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Amount (AZN)" htmlFor="claim-amount">
              <Input id="claim-amount" inputMode="decimal" value={draft.paidClaim?.amount ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), amount: e.target.value || null } })} />
            </Field>
            <Field label="Date" htmlFor="claim-date">
              <Input id="claim-date" type="date" max={today} value={draft.paidClaim?.date ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), date: e.target.value || null } })} />
            </Field>
            <Field label="Channel" htmlFor="claim-channel">
              <Input id="claim-channel" value={draft.paidClaim?.channel ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), channel: e.target.value || null } })} />
            </Field>
            <Field label="Reference" htmlFor="claim-ref">
              <Input id="claim-ref" value={draft.paidClaim?.reference ?? ""} onChange={(e) => set({ paidClaim: { ...(draft.paidClaim ?? {}), reference: e.target.value || null } })} onFocus={() => !draft.paidClaim && set({ paidClaim: {} })} />
            </Field>
          </div>
          <p className="mt-1 text-xs text-muted">Opens a reconciliation task and a temporary contact hold. Balances change only after a verified core posting.</p>
        </fieldset>
      )}
      {draft.identityStatus === "WRONG_NUMBER" && (
        <Field label="Which contact point is wrong?" htmlFor="wrong-cp" required>
          <Select id="wrong-cp" value={draft.wrongNumber?.contactPointId ?? ""} onChange={(e) => set({ wrongNumber: { contactPointId: e.target.value } })}>
            <option value="">Select…</option>
            {(customer?.contacts ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.type} {c.value} {c.isPrimary ? "(primary)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {draft.businessOutcome === "DISPUTE" && (
        <Field label="Dispute reason" htmlFor="dispute" required>
          <Input id="dispute" value={draft.dispute?.reason ?? ""} onChange={(e) => set({ dispute: { reason: e.target.value } })} />
        </Field>
      )}
      {(draft.businessOutcome === "SUPPORT_NEEDED" || draft.businessOutcome === "SPECIAL_REFERRAL") && (
        <fieldset className="col-span-full rounded-md border border-line p-3">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Referral</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Type" htmlFor="support-type" required>
              <Select id="support-type" value={draft.support?.type ?? ""} onChange={(e) => set({ support: { reason: draft.support?.reason ?? "", type: e.target.value as NonNullable<OutcomeDraft["support"]>["type"] } })}>
                <option value="">Select…</option>
                {draft.businessOutcome === "SUPPORT_NEEDED" ? (
                  <>
                    <option value="HARDSHIP">Hardship / repayment support</option>
                    <option value="COMPLAINT">Complaint</option>
                  </>
                ) : (
                  <>
                    <option value="SPECIAL_HANDLING">Special handling</option>
                    <option value="DECEASED_LEGAL">Deceased / legal notification</option>
                  </>
                )}
              </Select>
            </Field>
            <Field label="Reason (concise, factual)" htmlFor="support-reason" required>
              <Input id="support-reason" value={draft.support?.reason ?? ""} onChange={(e) => set({ support: { type: draft.support?.type ?? (draft.businessOutcome === "SUPPORT_NEEDED" ? "HARDSHIP" : "SPECIAL_HANDLING"), reason: e.target.value } })} />
            </Field>
          </div>
        </fieldset>
      )}
      <Field label="Additional note" htmlFor="note" hint={draft.nonPaymentReason === "OTHER" || draft.businessOutcome === "SPECIAL_REFERRAL" ? "Required for 'Other' and special referrals." : "Optional. Avoid unnecessary sensitive narrative."} >
        <Textarea id="note" value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} rows={compact ? 2 : 3} />
      </Field>
      <div className="col-span-full flex items-center gap-2 text-xs">
        <Badge tone={saveState === "saved" ? "info" : saveState === "error" ? "danger" : "neutral"}>{saveState === "saving" ? "Saving draft…" : saveState === "saved" ? "Draft saved / not yet submitted" : saveState === "error" ? "Draft save failed" : "Draft"}</Badge>
        <span className="text-muted">Final validation and provider wrap-up occur after the call ends.</span>
      </div>
    </div>
  );
}
