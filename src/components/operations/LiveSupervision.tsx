"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Card, Kpi, Toast, type Tone } from "@/components/ui";
import { fmtAzn, fmtDuration, humanize } from "@/lib/format";
import type { JsonOf } from "@/components/agent/types";
import type { teamGrid } from "@/server/modules/operations/operationsService";

type Data = JsonOf<Awaited<ReturnType<typeof teamGrid>>>;
const TONE: Record<string, Tone> = { READY: "success", TALKING: "success", RESERVED: "info", DIALING: "info", ACW: "warning", NOT_READY: "warning", BREAK: "neutral", OFFLINE: "neutral", CONNECTION_PROBLEM: "danger" };

export function LiveSupervision({ initial, canManage }: { initial: Data; canManage: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Data>(initial);
  const [toast, setToast] = useState<string | null>(null);
  const [rebalance, setRebalance] = useState<{ basis: string; items: number; unassignable: number; distribution: { name: string; suggested: number; seniority?: string | null; languages: string[] }[]; note: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(async () => {
      setTick((x) => x + 1);
      try {
        const r = await fetch("/api/operations/live", { cache: "no-store" });
        const j = await r.json();
        if (j.ok) setData((d) => ({ ...d, ...j.data, agents: j.data.agents.map((a: Data["agents"][number]) => ({ ...d.agents.find((x) => x.userId === a.userId), ...a })) }));
      } catch {
        /* keep last */
      }
    }, 3000);
    return () => clearInterval(id);
  }, []);
  const elapsed = (since: string | null) => (since ? Math.round((new Date(data.now).getTime() + tick * 0 - new Date(since).getTime()) / 1000) : null);
  async function control(action: string, extra: Record<string, unknown> = {}) {
    const reason = window.prompt("Reason (audited):");
    if (!reason) return;
    const r = await fetch("/api/operations/controls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason, ...extra }) });
    const j = await r.json();
    setToast(j.ok ? "Control applied" : j.error.message);
    router.refresh();
  }
  async function assist(interactionId: string, action: "RETRY_PROVIDER_WRAPUP" | "RECONCILE_MANUALLY") {
    const reason = window.prompt(`${action === "RETRY_PROVIDER_WRAPUP" ? "Retry provider wrap-up" : "Record manual reconciliation"} — reason (audited):`);
    if (!reason) return;
    const r = await fetch("/api/operations/assist-wrapup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interactionId, action, reason }) });
    const j = await r.json();
    setToast(j.ok ? "Done" : j.error.message);
  }
  const s = data.summary;
  return (
    <div className="space-y-3">
      <Toast message={toast} tone="info" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Signed-in agents" value={`${s.signedIn} / ${s.roster}`} note="Offline roster shown separately" />
        <Kpi label="Ready / talking" value={`${s.ready} / ${s.talking}`} note="Reserved is a separate state" />
        <Kpi label="Pending wrap-up" value={s.pendingWrapUp} note="No next call until saved and acknowledged" tone={s.pendingWrapUp ? "warning" : undefined} />
        <Kpi label="Eligible backlog" value={s.eligibleBacklog} note="Prioritized / restrictions applied" />
        <Kpi label="Senior-only backlog" value={s.seniorBacklog} note={`${s.seniorsOnline} seniors online · overflow ${s.seniorOverflow}`} tone={s.seniorOverflow ? "danger" : undefined} />
        <Kpi label="Overdue callbacks" value={s.overdueCallbacks} note="Due > 15 min ago" tone={s.overdueCallbacks ? "warning" : undefined} />
        <Kpi label="Integration exceptions" value={s.screenPopDelays + s.suppressionFailures + s.withdrawalUnknown + s.failedWrapUps} note={`pop ${s.screenPopDelays} · suppression ${s.suppressionFailures} · withdrawal ${s.withdrawalUnknown} · wrap-up ${s.failedWrapUps}`} tone={s.failedWrapUps + s.suppressionFailures + s.withdrawalUnknown ? "danger" : undefined} />
        <Kpi label="Outbox / dead letters" value={`${s.outboxPending} / ${s.deadLetters}`} note={s.workerOnline ? "Worker online" : "Worker offline"} tone={!s.workerOnline || s.deadLetters ? "danger" : undefined} />
      </div>
      {(data.controls.killSwitch || data.controls.pausedChannels.length > 0 || data.controls.pausedCampaigns.length > 0) && <Callout tone="danger">Outbound controls active: {data.controls.killSwitch ? "KILL SWITCH ON · " : ""}{data.controls.pausedChannels.length ? `paused channels ${data.controls.pausedChannels.join(", ")} · ` : ""}{data.controls.pausedCampaigns.length ? `paused campaigns ${data.controls.pausedCampaigns.join(", ")}` : ""}</Callout>}
      <Card title="Live agent monitor" subtitle="Provider-confirmed states; durations are system-derived" padded={false}>
        <div className="overflow-x-auto">
          <table className="table-dense">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Confirmed state</th>
                <th>Elapsed</th>
                <th>Current customer</th>
                <th>Queue / skill</th>
                <th>Ring / talk / ACW</th>
                <th>Outcome save</th>
                <th>CTI / device</th>
                <th>Operational state</th>
                <th className="num">Attempts</th>
                <th className="num">RPC</th>
                <th className="num">PTP</th>
                <th className="num">Assigned</th>
                <th className="num">Callbacks</th>
                <th className="num">Attributed cash</th>
                {canManage && <th>Assist</th>}
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.userId}>
                  <td>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted">
                      {humanize(a.role)} · {a.languages.join("/")} · ext {a.extension ?? "—"}
                    </div>
                  </td>
                  <td>
                    <Badge tone={TONE[a.confirmedState] ?? "neutral"}>{humanize(a.confirmedState)}</Badge>
                    {a.requestedState && a.requestedState !== a.confirmedState && <div className="text-xs text-muted">requested {humanize(a.requestedState)}</div>}
                    {a.pendingBreak && <div className="text-xs text-warning">break after wrap-up</div>}
                  </td>
                  <td className="tabular-nums">{fmtDuration(elapsed(a.stateSince))}</td>
                  <td>{a.currentCustomer ? <Link href={`/customers/${a.currentCustomer.id}`}>{a.currentCustomer.id}</Link> : a.confirmedState === "READY" ? "Awaiting work" : "None"}{a.currentCustomer ? <div className="text-xs text-muted">{a.currentCustomer.status.toLowerCase()} · bucket {a.currentCustomer.bucket ?? "—"}</div> : null}</td>
                  <td>{a.queue}</td>
                  <td className="text-xs tabular-nums">{fmtDuration(a.ringSeconds)} / {fmtDuration(a.talkSeconds)} / {fmtDuration(a.acwSeconds)}</td>
                  <td>
                    {a.outcomeState}
                    {a.callControl && (a.callControl.lastError || a.callControl.pending.length > 0 || a.callControl.muted || a.callControl.held) && (
                      <div className={`text-xs ${a.callControl.lastError ? "text-danger" : "text-muted"}`}>
                        {[a.callControl.muted ? "muted" : null, a.callControl.held ? "on hold" : null, a.callControl.pending.length ? `pending ${a.callControl.pending.join("/").toLowerCase()}` : null, a.callControl.lastError].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="text-xs">
                    <span className={a.ctiConnected ? "text-success" : "text-danger"}>{a.ctiStatus.toLowerCase()}</span>
                    {a.heartbeatAgeSec !== null && <span className="text-muted"> · browser {a.heartbeatAgeSec}s</span>}
                  </td>
                  <td className="text-xs">{a.operational}</td>
                  <td className="num">{a.attemptsToday}</td>
                  <td className="num">{a.rpcToday}</td>
                  <td className="num">{a.ptpToday}</td>
                  <td className="num">{a.assigned}</td>
                  <td className="num">{a.callbacksDue}</td>
                  <td className="num">{fmtAzn(a.attributedCash, false)}</td>
                  {canManage && (
                    <td>
                      {a.interactionId && a.interactionStatus === "OPEN" && (
                        <Button size="sm" variant="danger" title="Ends the call on our side when the provider did not confirm End; the agent must still save the outcome" onClick={() => control("FORCE_END_CALL", { interactionId: a.interactionId })}>Force end call</Button>
                      )}
                      {a.interactionId && (a.outcomeState === "Wrap-up failed" || a.outcomeState === "Awaiting provider ack") && (
                        <div className="flex flex-col gap-1">
                          <Button size="sm" onClick={() => assist(a.interactionId!, "RETRY_PROVIDER_WRAPUP")}>Retry wrap-up</Button>
                          <Button size="sm" variant="ghost" onClick={() => assist(a.interactionId!, "RECONCILE_MANUALLY")}>Reconcile manually</Button>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Controls and escalation" subtitle="Pause new allocations, inspect a stuck wrap-up, or reassign an eligible callback with a reason. No silent outcome edits.">
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {data.controls.killSwitch ? <Button variant="primary" onClick={() => control("KILL_SWITCH_OFF")}>Release kill switch</Button> : <Button variant="danger" onClick={() => control("KILL_SWITCH_ON")}>Emergency stop all outbound</Button>}
              {data.controls.pausedChannels.includes("VOICE") ? <Button onClick={() => control("RESUME_CHANNEL", { channel: "VOICE" })}>Resume voice</Button> : <Button onClick={() => control("PAUSE_CHANNEL", { channel: "VOICE" })}>Pause voice allocations</Button>}
              {data.controls.pausedChannels.includes("SMS") ? <Button onClick={() => control("RESUME_CHANNEL", { channel: "SMS" })}>Resume SMS</Button> : <Button onClick={() => control("PAUSE_CHANNEL", { channel: "SMS" })}>Pause SMS</Button>}
              {data.controls.campaigns.map((c) => (data.controls.pausedCampaigns.includes(c.code) ? <Button key={c.code} onClick={() => control("RESUME_CAMPAIGN", { campaignCode: c.code })}>Resume {c.code}</Button> : <Button key={c.code} onClick={() => control("PAUSE_CAMPAIGN", { campaignCode: c.code })}>Pause {c.code}</Button>))}
              <Button variant="secondary" onClick={async () => { const r = await fetch("/api/operations/rebalance", { method: "POST" }); const j = await r.json(); if (j.ok) setRebalance(j.data); }}>Simulate rebalance</Button>
              <Link href="/tasks?type=CALLBACK" className="btn btn-secondary">Reassign callbacks</Link>
              <Button variant="ghost" onClick={async () => { const r = await fetch("/api/decisions/run", { method: "POST" }); const j = await r.json(); setToast(j.ok ? `Decision run ${j.data.runId}: ${j.data.population} customers, ${j.data.scored} scored` : j.error.message); router.refresh(); }}>Run decision snapshot now</Button>
            </div>
          ) : (
            <p className="text-sm text-muted">Read-only: operations.manage permission required for controls.</p>
          )}
          {rebalance && (
            <div className="mt-3 text-sm">
              <p className="text-xs text-muted">Basis: {rebalance.basis} · {rebalance.items} items · {rebalance.unassignable} unassignable (no skill/language match). {rebalance.note}</p>
              <ul className="mt-1">
                {rebalance.distribution.map((d) => (<li key={d.name}>{d.name} ({d.seniority?.toLowerCase()}, {d.languages.join("/")}): suggested {d.suggested}</li>))}
              </ul>
            </div>
          )}
        </Card>
        <Card title="Execution health" subtitle="Check screen-pop delay, CTI state mismatches, payment-driven withdrawals and confirmed suppression. Unknown provider state pauses routing.">
          <dl className="dl-grid text-sm">
            <dt>Allocation rules</dt>
            <dd className="font-normal">Restrictions → due follow-ups → skill and priority → capacity → atomic claim. Related loans stay with one customer owner.</dd>
            <dt>Senior overflow</dt>
            <dd className="font-normal">{s.seniorOverflow > 0 ? `${s.seniorOverflow} senior-only items exceed online senior capacity; backlog remains visible and owned by the senior queue (no silent downgrade).` : "Within online senior capacity."}</dd>
            <dt>Provider</dt>
            <dd className="font-normal">MOCK_DIALER (progressive). Transfer unsupported. Wrap-up timeout cannot return an unsaved agent to Ready (server-side gate).</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
