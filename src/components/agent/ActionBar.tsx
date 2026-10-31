"use client";
import { useState } from "react";
import { Badge, Button, Dialog } from "@/components/ui";
import { fmtAzn, fmtDate, fmtDateTime } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at, errorText } from "@/i18n/agentText";
import { nextActionLabel, ot } from "@/i18n/outcomeText";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import type { PreviewResult } from "@/components/agent/ConversationFlow";
import { isPromise } from "@/components/agent/conversation";
import { api } from "@/components/agent/useAgentStream";

/**
 * Slim bottom bar: one line that says what will be stored and what happens next, and the single final save. The
 * idempotency key is derived from the interaction, so a double click, a second tab or a retry after a reload never
 * stores the outcome (or its promise, callback and wrap-up) twice. Saving is only possible once the provider has
 * confirmed the end of the call.
 */
export function ActionBar({ ctx, locale, draft, preview, callActive, onSaved }: { ctx: AgentContext; locale: Locale; draft: OutcomeDraft; preview: PreviewResult | null; callActive: boolean; onSaved: () => void }) {
  const A = (k: string, v?: Record<string, string | number | null>) => at(locale, k, v);
  const T = (k: string) => t(locale, k);
  const i = ctx.interaction!;
  const [saving, setSaving] = useState<"next" | "pause" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const idempotencyKey = `outcome:${i.id}`;
  const saved = i.status === "SAVED" || i.status === "CORRECTED";
  const blocking = preview?.errors ?? [];
  const ready = !!draft.identityStatus && !!draft.businessOutcome && !!preview && blocking.length === 0;

  async function save(returnReady: boolean) {
    if (saving || saved) return;
    setSaving(returnReady ? "next" : "pause");
    setError(null);
    setErrors([]);
    const r = await api<{ duplicate: boolean }>(`/api/agent/interactions/${i.id}/outcome`, { ...draft, idempotencyKey, returnReady });
    setSaving(null);
    if (!r.ok) {
      setError(errorText(locale, r.error));
      const details = r.error.details as { errors?: string[] } | null;
      if (details?.errors) setErrors(details.errors);
      setOpen(true);
      return;
    }
    onSaved();
  }

  const promise = isPromise(draft.businessOutcome) ? draft.ptp : null;
  // Identity is shown in the conversation; the line says what will be stored: outcome, amount, date.
  const parts = [
    draft.businessOutcome ? T(`agent.outcomes.${preview?.derivedOutcome ?? draft.businessOutcome}`) : draft.identityStatus ? ot(locale, `id.${draft.identityStatus}`) : A("bar.notSelected"),
    promise?.amount ? fmtAzn(promise.amount, true, locale) : null,
    promise?.deadlineDate ? fmtDate(promise.deadlineDate, locale) : null,
    draft.businessOutcome === "CALLBACK_REQUESTED" && draft.callback?.dueAt ? fmtDateTime(draft.callback.dueAt, false, locale) : null,
  ].filter(Boolean);
  const next = preview ? `${A("bar.next")}: ${nextActionLabel(locale, preview.nextAction)}` : null;
  const disabledReason = callActive ? A("bar.endFirst") : !ready ? A("bar.incomplete") : undefined;

  return (
    <>
      <section className="slim-bar" aria-label={A("bar.narrative")} data-testid="review-strip">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-medium text-ink" data-testid="outcome-line" title={[parts.join(" · "), next].filter(Boolean).join(" · ")}>
            {parts.join(" · ")}
            {preview?.coverage === "PARTIAL" && <span className="status-chip chip-warning ml-2 align-middle">{A("conv.partialShort")}</span>}
          </p>
          {blocking.length > 0 || error ? (
            <p className="mt-0.5 truncate text-[13px] text-danger" data-testid="preview-errors">
              {error ?? blocking[0]}
              {blocking.length > 1 ? ` (+${blocking.length - 1})` : ""}
            </p>
          ) : (
            <p className="mt-0.5 truncate text-[13px] text-muted" data-testid="outcome-hint">{callActive ? A("bar.endFirst") : next}</p>
          )}
        </div>
        <button type="button" className="text-sm text-brand hover:underline disabled:text-muted disabled:no-underline" onClick={() => setOpen(true)} disabled={!preview && !error} data-testid="outcome-details">
          {A("bar.details")}
        </button>
        {saved ? (
          <Badge tone="success">{A("bar.saved")} · {A("bar.waitingAck")}</Badge>
        ) : (
          <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:w-auto sm:items-center">
            <Button variant="soft" className="whitespace-normal leading-tight sm:min-w-44 sm:whitespace-nowrap" disabled={callActive || !ready || !!saving} title={disabledReason} onClick={() => save(false)} data-testid="save-pause">
              {saving === "pause" ? A("bar.saving") : A("bar.savePause")}
            </Button>
            <Button variant="primary" className="whitespace-normal leading-tight sm:min-w-56 sm:whitespace-nowrap" disabled={callActive || !ready || !!saving} title={disabledReason} onClick={() => save(true)} data-testid="save-next">
              {saving === "next" ? A("bar.saving") : A("bar.saveNext")}
            </Button>
          </div>
        )}
      </section>
      {callActive && !saved && <p className="sr-only" aria-live="polite">{A("bar.endFirst")}</p>}

      <Dialog open={open} onClose={() => setOpen(false)} title={A("bar.narrative")}>
        <div className="space-y-3 text-sm" data-testid="outcome-dialog">
          {preview ? <p className="leading-relaxed" data-testid="factual-summary">{preview.factualSummary}</p> : <p className="text-muted">{A("bar.incomplete")}</p>}
          {preview && (
            <div className="kv-row">
              <span className="kv-label">{A("bar.next")}</span>
              <span className="kv-value">
                {nextActionLabel(locale, preview.nextAction)}
                {preview.routineCallsBlockedUntil ? ` · ${A("bar.blockedUntil", { date: fmtDateTime(preview.routineCallsBlockedUntil, false, locale) })}` : ""}
              </span>
            </div>
          )}
          {preview?.referral && (
            <div className="kv-row">
              <span className="kv-label">{A("bar.referral")}</span>
              <span className="kv-value">{preview.referral}</span>
            </div>
          )}
          {(blocking.length > 0 || errors.length > 0 || error) && (
            <div className="callout callout-danger">
              <p className="font-semibold">{A("bar.fix")}</p>
              {error && <p>{error}</p>}
              <ul className="list-disc pl-5">
                {[...new Set([...blocking, ...errors])].map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
          {(preview?.warnings ?? []).length > 0 && (
            <div className="callout callout-warning" data-testid="preview-warnings">
              <p className="font-semibold">{A("bar.notice")}</p>
              <ul className="list-disc pl-5">{preview!.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setOpen(false)}>{A("bar.close")}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
