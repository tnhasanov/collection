"use client";
import { useState } from "react";
import { Badge, Button, Callout } from "@/components/ui";
import { fmtDateTime, humanize } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import type { PreviewResult } from "@/components/agent/OutcomeForm";
import { api } from "@/components/agent/useAgentStream";

/**
 * Sticky bottom action bar: the generated factual summary, the derived next action and exactly one final
 * confirmation ("Save & next call" or "Save & pause"). It never leaves the viewport while the agent scrolls.
 */
export function ActionBar({ ctx, locale, draft, preview, callActive, onSaved }: { ctx: AgentContext; locale: Locale; draft: OutcomeDraft; preview: PreviewResult | null; callActive: boolean; onSaved: () => void }) {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const i = ctx.interaction!;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
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
  const outcomeLabel = preview ? tt(`agent.outcomes.${preview.derivedOutcome}`) : null;
  return (
    <section className="action-bar" aria-label="Review and save" data-testid="review-strip">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted">{tt("agent.review.summary")}</span>
            {preview && <Badge tone="brand">{tt("agent.review.storedAs")}: {outcomeLabel}</Badge>}
            {preview?.coverage === "PARTIAL" && <Badge tone="warning">partial · {preview.coveredOverdue} AZN overdue</Badge>}
            {preview && <span className="text-muted">{tt("agent.review.nextAction")}: {humanize(preview.nextAction)}{preview.routineCallsBlockedUntil ? ` · ${tt("agent.review.blockedUntil", { date: fmtDateTime(preview.routineCallsBlockedUntil) })}` : ""}{preview.callbackAt ? ` · ${tt("agent.review.callback")} ${fmtDateTime(preview.callbackAt)}` : ""}</span>}
            {preview && <button type="button" className="text-brand underline" onClick={() => setOpen((o) => !o)}>{tt("agent.review.details")}</button>}
          </div>
          {preview ? (
            <p className={`mt-1 text-sm leading-relaxed ${open ? "" : "line-clamp-2"}`} data-testid="factual-summary">{preview.factualSummary}</p>
          ) : (
            <p className="mt-1 text-sm text-muted">{tt("agent.review.summaryHint")}</p>
          )}
          {open && preview?.referral && <p className="mt-1 text-xs text-muted">{tt("agent.review.referral")}: {preview.referral}</p>}
          {hardErrors.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-danger" data-testid="preview-errors">{hardErrors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {error && <Callout tone="danger" className="mt-2">{error}{errors.length > 0 && <ul className="mt-1 list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}</Callout>}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div>{saved ? <Badge tone="success">{tt("agent.review.saved")} · {i.wrapUpStatus === "ACKNOWLEDGED" ? "ack" : i.wrapUpStatus === "FAILED" ? "wrap-up failed" : "wrap-up pending"}</Badge> : callActive ? <Badge tone="info">{tt("agent.review.capturing")}</Badge> : requiredOk ? <Badge tone="success">{tt("agent.review.ready")}</Badge> : <Badge tone="warning">{tt("agent.review.incomplete")}</Badge>}</div>
          {!saved && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="primary" disabled={callActive || !requiredOk || saving} title={callActive ? tt("agent.review.endFirst") : undefined} onClick={() => save(true)} data-testid="save-next">{saving ? "…" : tt("agent.review.saveNext")}</Button>
              <Button variant="secondary" disabled={callActive || !requiredOk || saving} onClick={() => save(false)} data-testid="save-pause">{tt("agent.review.savePause")}</Button>
            </div>
          )}
          <p className="max-w-xs text-right text-[11px] text-muted">{callActive ? tt("agent.form.draftNote") : tt("agent.review.oneSave")}</p>
        </div>
      </div>
    </section>
  );
}
