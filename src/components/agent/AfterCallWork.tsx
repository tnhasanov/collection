"use client";
import { Badge, Card, Callout } from "@/components/ui";
import { fmtDateTime, fmtDuration, humanize } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { OutcomeForm, type PreviewResult } from "@/components/agent/OutcomeForm";
import { CustomerContext } from "@/components/agent/CustomerContext";
import { ReviewStrip } from "@/components/agent/ReviewStrip";

/** After-call work: the call context stays visible; most facts were captured during the call; one final save. */
export function AfterCallWork({ ctx, draft, setDraft, preview, setPreview, serverNow, onSaved, acwElapsed }: { ctx: AgentContext; draft: OutcomeDraft; setDraft: (d: OutcomeDraft) => void; preview: PreviewResult | null; setPreview: (p: PreviewResult | null) => void; serverNow: () => Date; onSaved: () => void; acwElapsed: number }) {
  const i = ctx.interaction!;
  const c = ctx.customer!;
  const saved = i.status === "SAVED" || i.status === "CORRECTED";
  return (
    <div className="space-y-3">
      <div className="callout callout-warning flex flex-wrap items-center gap-3" data-testid="acw-strip">
        <Badge tone="warning">ACW / {fmtDuration(acwElapsed)}</Badge>
        <span className="font-bold">{c.customer.displayName} · {i.correlationId} · conversation {fmtDuration(i.talkSeconds)} · next call blocked until saved and acknowledged</span>
        <span className="ml-auto text-xs">Technical result: {humanize(i.technicalResult)} (provider-observed) · ring {fmtDuration(i.ringSeconds)} · ended {fmtDateTime(i.endedAt, true)}</span>
      </div>
      {saved && <Callout tone="success">Outcome saved. Waiting for the provider wrap-up acknowledgment before the next call.</Callout>}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card><CustomerContext ctx={ctx} verified={draft.identityStatus === "RPC_VERIFIED"} /></Card>
        <Card title="Responses" subtitle="Captured during the call; review and complete what is missing">
          <OutcomeForm ctx={ctx} draft={draft} onChange={setDraft} onPreview={setPreview} serverNow={serverNow} />
        </Card>
      </div>
      <ReviewStrip ctx={ctx} draft={draft} preview={preview} callActive={false} onSaved={onSaved} />
    </div>
  );
}
