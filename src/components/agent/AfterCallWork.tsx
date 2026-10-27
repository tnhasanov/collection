"use client";
import { useState } from "react";
import { Badge, Button, Card, Callout } from "@/components/ui";
import { fmtDateTime, fmtDuration, humanize } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { OutcomeForm, type PreviewResult } from "@/components/agent/OutcomeForm";
import { api } from "@/components/agent/useAgentStream";

export function AfterCallWork({ ctx, draft, setDraft, preview, setPreview, serverNow, onSaved, acwElapsed }: { ctx: AgentContext; draft: OutcomeDraft; setDraft: (d: OutcomeDraft) => void; preview: PreviewResult | null; setPreview: (p: PreviewResult | null) => void; serverNow: () => Date; onSaved: () => void; acwElapsed: number }) {
  const i = ctx.interaction!;
  const c = ctx.customer!;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [idKey] = useState(() => `out-${i.id}-${Math.random().toString(36).slice(2, 10)}`);
  const requiredOk = !!draft.identityStatus && !!draft.businessOutcome && (preview ? preview.errors.filter((e) => !e.startsWith("Requested callback time")).length === 0 : false);

  async function save(returnReady: boolean) {
    setSaving(true);
    setError(null);
    setErrors([]);
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

  const saved = i.status === "SAVED" || i.status === "CORRECTED";
  return (
    <div className="space-y-3">
      <div className="callout callout-warning flex flex-wrap items-center gap-3">
        <Badge tone="warning">ACW / {fmtDuration(acwElapsed)}</Badge>
        <span className="font-bold">
          {i.correlationId} / conversation {fmtDuration(i.talkSeconds)} / next call blocked
        </span>
        <span className="ml-auto text-xs">Technical result: {humanize(i.technicalResult)} (provider) · ended {fmtDateTime(i.endedAt, true)}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Card title={`Call outcome / ${c.customer.displayName}`} subtitle="System result and agent business outcome are different facts">
          {saved ? (
            <Callout tone="success">Outcome saved. Waiting for the provider wrap-up acknowledgment before the next call.</Callout>
          ) : (
            <>
              <div className="mb-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="label">Technical result - provider</p>
                  <input className="input" value={humanize(i.technicalResult)} disabled aria-label="Technical result (provider-derived)" />
                </div>
                <div>
                  <p className="label">Durations - system derived</p>
                  <input className="input" value={`ring ${fmtDuration(i.ringSeconds)} · talk ${fmtDuration(i.talkSeconds)}`} disabled aria-label="Durations" />
                </div>
              </div>
              <OutcomeForm ctx={ctx} draft={draft} onChange={setDraft} onPreview={setPreview} serverNow={serverNow} />
              {error && (
                <Callout tone="danger" className="mt-3">
                  {error}
                  {errors.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </Callout>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="primary" disabled={!requiredOk || saving} onClick={() => save(true)}>
                  {saving ? "Saving…" : "Save outcome & return Ready"}
                </Button>
                <Button variant="secondary" disabled={!requiredOk || saving} onClick={() => save(false)}>
                  Save & stay Not ready
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted">Next distribution waits for the saved outcome and provider confirmation.</p>
            </>
          )}
        </Card>
        <div className="space-y-3">
          <Card title="Next-action preview" subtitle="Computed from outcome and policy">
            {preview ? (
              <dl className="dl-grid">
                <dt>Business effect</dt>
                <dd>{humanize(preview.nextAction)}</dd>
                <dt>Summary</dt>
                <dd className="font-normal">{preview.summary}</dd>
                <dt>Routine call restriction</dt>
                <dd>{preview.routineCallsBlockedUntil ? `No routine call before ${fmtDateTime(preview.routineCallsBlockedUntil)}` : "None from this outcome"}</dd>
                {preview.callbackAt && (
                  <>
                    <dt>Callback</dt>
                    <dd>{fmtDateTime(preview.callbackAt)}</dd>
                  </>
                )}
                <dt>Other loan campaigns</dt>
                <dd>Customer-wide suppression</dd>
                <dt>Digital reminders</dt>
                <dd className="font-normal">{preview.digitalReminders}</dd>
                {preview.referral && (
                  <>
                    <dt>Referral</dt>
                    <dd>{preview.referral}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">Select identity status and business outcome to preview the next action.</p>
            )}
            {preview && preview.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-danger">
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Save and readiness checkpoints">
            <dl className="dl-grid">
              <dt>Required fields</dt>
              <dd className={requiredOk ? "text-success" : "text-warning"}>{requiredOk ? "Valid" : "Incomplete"}</dd>
              <dt>Business outcome</dt>
              <dd className={saved ? "text-success" : "text-warning"}>{saved ? "Saved" : "Pending save"}</dd>
              <dt>Provider wrap-up</dt>
              <dd className={i.wrapUpStatus === "ACKNOWLEDGED" ? "text-success" : i.wrapUpStatus === "FAILED" ? "text-danger" : "text-warning"}>{i.wrapUpStatus === "ACKNOWLEDGED" ? "Acknowledged" : i.wrapUpStatus === "FAILED" ? "Failed - retrying / supervisor" : "Pending acknowledgment"}</dd>
              <dt>Next voice assignment</dt>
              <dd className="text-warning">Blocked until confirmed</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
