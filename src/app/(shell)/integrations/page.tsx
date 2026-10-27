import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { now } from "@/server/clock";
import { formatBakuDateTime } from "@/server/dates";
import { Badge, Card, Kpi } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { IntegrationActions, OutboxReplay } from "@/components/integrations/IntegrationActions";
import { getDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?reason=session");
  if (!hasPermission(user.role, "integration.read")) redirect("/access-denied");
  const t = await now();
  const [sources, outbox, dead, worker, jobs, receipts, events, quarantined, caps] = await Promise.all([
    prisma.sourceWatermark.findMany({ orderBy: { displayName: "asc" } }),
    prisma.outboxMessage.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboxMessage.findMany({ where: { status: { in: ["DEAD", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.workerHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" } }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
    prisma.commandReceipt.findMany({ orderBy: { requestedAt: "desc" }, take: 12 }),
    prisma.integrationEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.payment.count({ where: { status: "QUARANTINED" } }),
    getDialerAdapter().capabilities(),
  ]);
  const canOperate = hasPermission(user.role, "integration.operate");
  const workerOnline = !!worker && Date.now() - worker.lastSeenAt.getTime() < 60000;
  const count = (s: string) => outbox.find((o) => o.status === s)?._count._all ?? 0;
  const feed = sources.find((s) => s.sourceSystem === "PAYMENT_FEED");
  const lag = feed?.sourceAsOf ? Math.round((t.getTime() - feed.sourceAsOf.getTime()) / 60000) : null;
  return (
    <>
      <PageHeader kicker="S21 / integrations & job health" title="Integrations & job health" lead="Inspect source freshness, reconciliation and retry state without exposing secrets. Real connectors are off; every adapter here is a mock or local outbox." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Core / payment freshness" value={lag === null ? "n/a" : `${lag} min`} note={lag !== null && feed && lag * 60 > feed.freshnessThresholdSeconds ? "Beyond threshold" : "Within demo threshold"} tone={lag !== null && feed && lag * 60 > feed.freshnessThresholdSeconds ? "danger" : undefined} />
        <Kpi label="Quarantined events" value={quarantined} note="Owned review queue" href="/payments?tab=unmatched" />
        <Kpi label="Outbound real sending" value="Disabled" note="Demo adapters only" />
        <Kpi label="Duplicate replay" value="Safe" note={`${events.find((e) => e.status === "DUPLICATE")?._count._all ?? 0} replays ignored · stable business idempotency keys`} />
      </div>
      <Card className="mt-3" padded={false} title="Source / adapter health" subtitle={`Worker ${workerOnline ? `online (${worker?.id}, seen ${formatBakuDateTime(worker?.lastSeenAt, { seconds: true })})` : "OFFLINE — run npm run worker"}`}>
        <table className="table-dense">
          <thead>
            <tr><th>Source / adapter</th><th>Mode</th><th>Last successful run</th><th>Source watermark</th><th>Lag / threshold</th><th>Queue</th><th>Errors / DLQ</th><th>Schema</th><th>State</th><th>Operational action</th></tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.sourceSystem}>
                <td><div className="font-medium">{s.displayName}</div><div className="text-xs text-muted">{s.sourceSystem}{s.notes ? ` · ${s.notes}` : ""}</div></td>
                <td>{s.mode.replace(/_/g, " ").toLowerCase()}</td>
                <td>{formatBakuDateTime(s.lastSuccessfulRunAt)}</td>
                <td>{formatBakuDateTime(s.sourceAsOf)}</td>
                <td>{s.sourceAsOf ? `${Math.round((t.getTime() - s.sourceAsOf.getTime()) / 60000)} min` : "n/a"} / {Math.round(s.freshnessThresholdSeconds / 60)} min</td>
                <td>{s.queueDepth}</td>
                <td>{s.errorCount} / {s.deadLetterCount}</td>
                <td>{s.schemaVersion}</td>
                <td><Badge tone={s.health === "HEALTHY" ? "success" : s.health === "DISABLED" ? "neutral" : "warning"}>{s.paused ? "paused" : s.health.toLowerCase()}</Badge></td>
                <td>{canOperate ? <IntegrationActions source={s.sourceSystem} paused={s.paused} disabled={s.health === "DISABLED"} /> : <span className="text-xs text-muted">read-only</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card title="Transactional outbox" subtitle={`pending ${count("PENDING")} · processing ${count("PROCESSING")} · done ${count("DONE")} · failed ${count("FAILED")} · dead ${count("DEAD")}`}>
          {dead.length === 0 ? <p className="text-sm text-muted">No failed or dead-lettered messages.</p> : (
            <ul className="divide-y divide-line text-sm">
              {dead.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    <Badge tone={m.status === "DEAD" ? "danger" : "warning"}>{m.status.toLowerCase()}</Badge> {m.topic} · {m.idempotencyKey} · attempts {m.attempts}/{m.maxAttempts}
                    <div className="text-xs text-muted">{m.lastError}</div>
                  </span>
                  {canOperate && <OutboxReplay id={m.id} />}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">Replaying a message cannot resend a message or double-apply a payment: handlers are idempotent by business key.</p>
        </Card>
        <Card title="Dialer / CTI capabilities (mock provider)" subtitle={`${caps.provider} ${caps.version} · mode ${caps.mode} · dialing ${caps.dialingModes.join(", ")}`}>
          <ul className="grid grid-cols-2 gap-x-4 text-xs">
            {Object.entries({ "Event subscription": caps.eventSubscription, "Screen-pop metadata": caps.screenPopMetadata, "Agent state control": caps.agentStateControl, "Wrap-up submission": caps.wrapUpSubmission, "Wrap-up timeout configurable": caps.wrapUpTimeoutConfigurable, "Pre-dial eligibility hook": caps.preDialEligibilityHook, "Contact withdrawal": caps.contactWithdrawal, "Priority preservation": caps.priorityPreservation, Callbacks: caps.callbacks, Reconciliation: caps.reconciliation, "Active-call lookup after reconnect": caps.activeCallLookupAfterReconnect, Mute: caps.callControls.mute, Hold: caps.callControls.hold, Transfer: caps.callControls.transfer, End: caps.callControls.end, "Manual dial": caps.callControls.manualDial }).map(([k, v]) => (
              <li key={k}>{v ? "✓" : "✕"} {k}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">The bank&apos;s actual dialer (Orange voice application) is unidentified; see INTEGRATION_MAPPING.md for the capability checklist required before a pilot.</p>
          <h3 className="mt-3 text-xs font-bold uppercase tracking-wider text-muted">Recent command receipts</h3>
          <ul className="text-xs">
            {receipts.map((r) => (<li key={r.id}><Badge tone={r.status === "CONFIRMED" ? "success" : r.status === "UNKNOWN" ? "warning" : r.status === "REJECTED" ? "danger" : "neutral"}>{r.status.toLowerCase()}</Badge> {r.commandType} · {formatBakuDateTime(r.requestedAt, { seconds: true })} · {r.correlationId ?? r.idempotencyKey}</li>))}
          </ul>
        </Card>
      </div>
      <Card className="mt-3" title="Job runs" subtitle="Durable jobs run by the pg-boss worker (decision snapshot, maintenance, promise maturation, source refresh, SMS dispatch)">
        <table className="table-dense">
          <thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Finished</th><th>Detail</th></tr></thead>
          <tbody>
            {jobs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted">No job runs recorded yet</td></tr>}
            {jobs.map((j) => (<tr key={j.id}><td>{j.name}</td><td><Badge tone={j.status === "COMPLETED" ? "success" : j.status === "FAILED" ? "danger" : "info"}>{j.status.toLowerCase()}</Badge></td><td>{formatBakuDateTime(j.startedAt, { seconds: true })}</td><td>{formatBakuDateTime(j.finishedAt, { seconds: true })}</td><td className="text-xs text-muted">{j.error ?? JSON.stringify(j.detail)?.slice(0, 160)}</td></tr>))}
          </tbody>
        </table>
      </Card>
      <p className="callout callout-info mt-3">Execution safeguards: payment events refresh balances and invalidate obsolete tasks. Queue claim and dispatch re-check source freshness and contact eligibility. Retries, unknown provider responses and event replays preserve idempotency and an audit trail. No raw credentials or unrestricted PII appear in logs.</p>
    </>
  );
}
