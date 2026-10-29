"use client";
import { Badge, Card, Callout } from "@/components/ui";
import { fmtDateTime, fmtDuration, humanize } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { OutcomeForm, type PreviewResult } from "@/components/agent/OutcomeForm";
import { DetailsTabs } from "@/components/agent/DetailsTabs";
import { ActionBar } from "@/components/agent/ActionBar";

/** After-call work: the call context stays visible; most facts were captured during the call; one final save in the sticky bar. */
export function AfterCallWork({ ctx, locale, draft, setDraft, preview, setPreview, serverNow, onSaved, acwElapsed, showDiagnostics, onToast, onRefresh }: { ctx: AgentContext; locale: Locale; draft: OutcomeDraft; setDraft: (d: OutcomeDraft) => void; preview: PreviewResult | null; setPreview: (p: PreviewResult | null) => void; serverNow: () => Date; onSaved: () => void; acwElapsed: number; showDiagnostics: boolean; onToast: (m: string, tone?: "info" | "success" | "danger" | "warning") => void; onRefresh: () => void }) {
  const tt = (k: string) => t(locale, k);
  const i = ctx.interaction!;
  const c = ctx.customer!;
  const saved = i.status === "SAVED" || i.status === "CORRECTED";
  const verified = draft.identityStatus === "RPC_VERIFIED";
  return (
    <div className="space-y-3">
      <div className="callout callout-warning flex flex-wrap items-center gap-3" data-testid="acw-strip">
        <Badge tone="warning">{tt("agent.acw.title")} · {fmtDuration(acwElapsed)}</Badge>
        <span className="font-semibold">{c.customer.displayName} · {tt("agent.acw.conversation")} {fmtDuration(i.talkSeconds)} · {tt("agent.acw.nextBlocked")}</span>
        <span className="ml-auto text-xs">{tt("agent.acw.technical")}: {humanize(i.technicalResult)} · {tt("agent.acw.ended")} {fmtDateTime(i.endedAt, true)}{showDiagnostics ? ` · ${i.correlationId}` : ""}</span>
      </div>
      {saved && <Callout tone="success">{tt("agent.acw.savedWaiting")}</Callout>}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title={tt("agent.tabs.responses")}>
          <OutcomeForm ctx={ctx} locale={locale} draft={draft} onChange={setDraft} onPreview={setPreview} serverNow={serverNow} />
        </Card>
        <Card>
          <DetailsTabs ctx={ctx} locale={locale} verified={verified} showDiagnostics={showDiagnostics} onToast={onToast} onSent={onRefresh} />
        </Card>
      </div>
      <ActionBar ctx={ctx} locale={locale} draft={draft} preview={preview} callActive={false} onSaved={onSaved} />
    </div>
  );
}
