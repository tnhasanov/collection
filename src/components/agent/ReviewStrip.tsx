"use client";
import { useState } from "react";
import { Badge, Button, Callout } from "@/components/ui";
import { fmtDateTime, humanize } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { OUTCOME_LABELS_UI, type PreviewResult } from "@/components/agent/OutcomeForm";
import { api } from "@/components/agent/useAgentStream";

/**
 * Bottom review (blueprint §4/§5 step D–E): deterministic factual summary, derived next action and contact
 * eligibility, then exactly one final confirmation: "Save & next call" or "Save & pause".
 */
export function ReviewStrip({ ctx, draft, preview, callActive, onSaved }: { ctx: AgentContext; draft: OutcomeDraft; preview: PreviewResult | null; callActive: boolean; onSaved: () => void }) {
  const i = ctx.interaction!;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [idKey] = useState(() => `out-${i.id}-${Math.random().toString(36).slice(2, 10)}`);
  const saved = i.status === "SAVED" || i.status === "CORRECTED";
  const hardErrors = preview ? preview.errors.filter((e) => !e.startsWith("Requested callback time")) : [];
  const requiredOk = !!draft.identityStatus && !!draft.businessOutcome && !!preview && hardErrors.length === 0;

  async function save(returnReady: boolean) {
    setSaving(true); setError(null); setErrors([]);
    const r = await api<{ duplicate: boolean }>(`/api/agent/interactions/${i.id}/outcome`, { ...draft, idempotencyKey: idKey, returnReady });
    setSaving(false);
    if (!r.ok) {
      setError(r.error.message);
      const details = r.error.details as { errors?: string[] } | null;
      if (details?.errors) setErrors(details.errors);
      return;
    }
    onSaved();
  }

  return (
    <section className="card card-pad" aria-label="Review and save" data-testid="review-strip">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div>
          <p className="step-label"><span className="step-no">D</span> Factual summary (generated from the selected facts)</p>
          {preview ? (
            <p className="text-sm leading-relaxed" data-testid="factual-summary">{preview.factualSummary}</p>
          ) : (
            <p className="text-sm text-muted">Select who is speaking and the outcome; the summary is generated from the facts, never typed.</p>
          )}
          {preview && (
            <p className="mt-1 text-xs text-muted">
              Outcome to be stored: <strong>{OUTCOME_LABELS_UI[preview.derivedOutcome] ?? humanize(preview.derivedOutcome)}</strong>
              {preview.coverage === "PARTIAL" && ` · partial: ${preview.coveredOverdue} AZN overdue on the covered loans`}
              {preview.coverage === "FULL" && " · covers the overdue amount in full"}
              {" · policy "}{preview.policyVersion}
            </p>
          )}
          {hardErrors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-danger" data-testid="preview-errors">{hardErrors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          {error && <Callout tone="danger" className="mt-2">{error}{errors.length > 0 && <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}</Callout>}
        </div>
        <div>
          <p className="step-label"><span className="step-no">E</span> Next action &amp; confirmation</p>
          <dl className="dl-grid text-sm">
            <dt>Next action</dt>
            <dd>{preview ? humanize(preview.nextAction) : "—"}</dd>
            <dt>Routine calls</dt>
            <dd>{preview?.routineCallsBlockedUntil ? `Blocked until ${fmtDateTime(preview.routineCallsBlockedUntil)} (customer-wide)` : preview ? "No new restriction from this outcome" : "—"}</dd>
            {preview?.callbackAt && (<><dt>Callback</dt><dd>{fmtDateTime(preview.callbackAt)}</dd></>)}
            {preview?.referral && (<><dt>Referral</dt><dd>{preview.referral}</dd></>)}
            <dt>Status</dt>
            <dd>{saved ? <Badge tone="success">Saved · provider wrap-up {i.wrapUpStatus === "ACKNOWLEDGED" ? "acknowledged" : i.wrapUpStatus === "FAILED" ? "failed (supervisor)" : "pending"}</Badge> : callActive ? <Badge tone="info">Capturing during the call</Badge> : requiredOk ? <Badge tone="success">Ready to save</Badge> : <Badge tone="warning">Incomplete</Badge>}</dd>
          </dl>
          {!saved && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" disabled={callActive || !requiredOk || saving} title={callActive ? "End the call first; the next call waits for the saved outcome and provider wrap-up" : undefined} onClick={() => save(true)} data-testid="save-next">{saving ? "Saving…" : "Save & next call"}</Button>
              <Button variant="secondary" disabled={callActive || !requiredOk || saving} onClick={() => save(false)} data-testid="save-pause">Save & pause</Button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">{callActive ? "One final confirmation after the call ends; a draft never submits an agreement." : "One final save commits the outcome and its policy effects, synchronizes the provider wrap-up and confirms readiness."}</p>
        </div>
      </div>
    </section>
  );
}
