"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, Card, Toast } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { fmtAzn, fmtDate, fmtDateTime, fmtDuration, humanize } from "@/lib/format";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api, useAgentStream } from "@/components/agent/useAgentStream";
import { AvailabilityBar } from "@/components/agent/AvailabilityBar";
import { HomePanels } from "@/components/agent/HomePanels";
import { CustomerContext } from "@/components/agent/CustomerContext";
import { ScriptPanel } from "@/components/agent/ScriptPanel";
import { OutcomeForm, type PreviewResult } from "@/components/agent/OutcomeForm";
import { AfterCallWork } from "@/components/agent/AfterCallWork";

export interface AgentUser {
  id: string;
  displayName: string;
  roleLabel: string;
  teamName: string | null;
  languages: string[];
  manualDialAllowed: boolean;
}

export function AgentDesktop({ initial, user, focus }: { initial: AgentContext | null; user: AgentUser; focus?: "home" | "call" }) {
  const { ctx, connected, serverNow, refreshFull } = useAgentStream(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "success" | "danger" | "warning" } | null>(null);
  const [draft, setDraft] = useState<OutcomeDraft>({});
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Hydrate the recoverable draft from the backend when a new interaction appears (refresh/reconnect safe).
  // (React "adjust state when a prop changes" pattern: runs during render, no effect needed.)
  const currentInteraction = ctx?.interaction ?? null;
  if ((currentInteraction?.id ?? null) !== draftFor) {
    setDraftFor(currentInteraction?.id ?? null);
    setDraft((currentInteraction?.draft as OutcomeDraft | null) ?? {});
    setPreview(null);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);
  const latestNotification = ctx?.notifications?.[0] ?? null;
  const [notifiedId, setNotifiedId] = useState<string | null>(null);
  if (latestNotification && latestNotification.id !== notifiedId) {
    setNotifiedId(latestNotification.id);
    setToast({ message: latestNotification.message, tone: "info" });
  }
  useEffect(() => {
    if (!latestNotification) return;
    void fetch("/api/agent/notifications/read", { method: "POST" });
  }, [latestNotification]);

  const session = ctx?.session ?? null;
  const reservation = ctx?.reservation ?? null;
  const interaction = ctx?.interaction ?? null;
  const confirmed = session?.confirmedState ?? "OFFLINE";
  const verified = draft.identityStatus === "RPC_VERIFIED";
  const thirdParty = draft.identityStatus === "THIRD_PARTY";

  async function connect() {
    setBusy(true);
    const r = await api("/api/agent/session");
    setBusy(false);
    if (!r.ok) setToast({ message: r.error.message, tone: "danger" });
    else await refreshFull();
  }
  async function changeState(state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) {
    setBusy(true);
    const r = await api<{ deferred: boolean }>("/api/agent/state", { state, reason: reason ?? null });
    setBusy(false);
    if (!r.ok) setToast({ message: r.error.message, tone: "danger" });
    else if (r.data.deferred) setToast({ message: `${humanize(state)} will apply after the required wrap-up.`, tone: "warning" });
    else setToast({ message: `${humanize(state)} requested; waiting for provider confirmation.`, tone: "info" });
    if (state === "OFFLINE" && r.ok && !r.data.deferred) setTimeout(() => void refreshFull(), 1500);
  }
  async function control(action: "MUTE" | "UNMUTE" | "HOLD" | "RESUME" | "END") {
    if (!interaction) return;
    const r = await api("/api/agent/call-control", { interactionId: interaction.id, action });
    if (!r.ok) setToast({ message: r.error.message, tone: "danger" });
    else setToast({ message: `${humanize(action)} requested from the provider`, tone: "info" });
  }

  const callElapsed = useMemo(() => {
    void tick;
    if (interaction?.connectedAt && !interaction.endedAt) return Math.round((serverNow().getTime() - new Date(interaction.connectedAt).getTime()) / 1000);
    if (reservation?.attempt?.startedAt && !reservation.attempt.endedAt) return Math.round((serverNow().getTime() - new Date(reservation.attempt.startedAt).getTime()) / 1000);
    return 0;
  }, [tick, interaction, reservation, serverNow]);
  const acwElapsed = useMemo(() => {
    void tick;
    return interaction?.acwStartedAt ? Math.round((serverNow().getTime() - new Date(interaction.acwStartedAt).getTime()) / 1000) : 0;
  }, [tick, interaction, serverNow]);

  if (!ctx) return <p className="text-muted">Loading agent workspace…</p>;

  const mode: "connect" | "home" | "dialing" | "live" | "acw" | "wrapup" | "recovery" =
    !session || !session.id
      ? "connect"
      : interaction && interaction.status === "OPEN"
        ? "live"
        : interaction && interaction.status === "DRAFT"
          ? "acw"
          : interaction && (interaction.wrapUpStatus === "PENDING" || interaction.wrapUpStatus === "FAILED")
            ? "wrapup"
            : reservation && ["PENDING", "AUTHORIZED", "DIALING"].includes(reservation.status)
              ? ctx.customer
                ? "dialing"
                : "recovery"
              : "home";

  return (
    <div className="space-y-3">
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
      {mode === "connect" ? (
        <>
          <PageHeader kicker="S28A / my collection workspace" title="My collection workspace" lead="Connect to the dialer to receive automatically assigned calls." />
          <Card title="Phone & connection" subtitle="Mapped extension and provider identity are confirmed by the CTI adapter (mock provider in DEMO)">
            <p className="text-sm">Sign in to the dialer to map your extension and join your authorized campaign queues. Ready is confirmed only when the provider confirms it.</p>
            <div className="mt-3">
              <Button variant="primary" onClick={connect} disabled={busy}>
                {busy ? "Connecting…" : "Connect to dialer"}
              </Button>
            </div>
            {!ctx.workerOnline && <Callout tone="danger" className="mt-3">The background worker is offline. Provider commands (state changes, dials, wrap-ups) are queued but will not execute until <code>npm run worker</code> runs.</Callout>}
          </Card>
        </>
      ) : (
        <>
          {mode === "home" && <PageHeader kicker="S28A / my collection workspace" title="My collection workspace" lead={`My campaign: ${session?.campaignCodes.join(", ") || "—"} - automatic call assignment after confirmed Ready.`} />}
          {mode === "dialing" && <PageHeader kicker="S28B / reserved" title="Reserved - dialing customer" lead={`Call ${reservation?.correlationId} / automatically assigned to ${user.displayName} / one active voice interaction.`} />}
          {mode === "live" && <PageHeader kicker="S28B / live customer conversation" title="Live customer conversation" lead={`Call ${interaction?.correlationId} / automatically assigned to ${user.displayName} / one active voice interaction.`} />}
          {mode === "acw" && <PageHeader kicker="S28C / after-call work" title="After-call work" lead="Call ended / outcome required before the next automatically assigned voice call." />}
          {mode === "wrapup" && <PageHeader kicker="S28C / wrap-up synchronization" title="Wrap-up pending acknowledgment" lead="Outcome saved. The provider has not yet acknowledged the wrap-up." />}
          {mode === "recovery" && <PageHeader kicker="S28B / recovery" title="Call context recovering" lead="A reservation exists but the customer screen is not ready. Provider controls stay available; routing is paused." />}

          <AvailabilityBar ctx={ctx} serverNow={serverNow} onAction={changeState} busy={busy} user={user} />
          {!connected && <Callout tone="warning">Live stream reconnecting; falling back to polling. Your session state is restored from the server, not from this browser.</Callout>}
          {confirmed === "CONNECTION_PROBLEM" && <Callout tone="danger">Provider connectivity problem: new allocation is paused. Existing voice continues on the PBX. {session?.stateReason}</Callout>}

          {(mode === "dialing" || mode === "live" || mode === "recovery") && (
            <section className="card card-pad flex flex-wrap items-center gap-3" aria-label="Call strip">
              <Badge tone={mode === "live" ? "success" : "info"}>
                {mode === "live" ? `Connected / ${fmtDuration(callElapsed)}` : reservation?.attempt?.ringingAt ? `Ringing / ${fmtDuration(callElapsed)}` : reservation?.status === "DIALING" ? `Dialing / ${fmtDuration(callElapsed)}` : "Reserved / awaiting provider"}
              </Badge>
              <span className="text-sm text-muted">
                {ctx.customer?.loans.map((l) => l.coreLoanId).join(", ")} / {ctx.customer?.customer.id ?? "—"} / {reservation?.maskedNumber ?? "number masked"} / {reservation?.campaignCode} / provider-confirmed call state
              </span>
              {reservation?.withdrawalStatus === "REQUESTED" && <Badge tone="warning">Withdrawal requested (payment before dial)</Badge>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" disabled={mode !== "live"} onClick={() => control("MUTE")}>
                  Mute
                </Button>
                <Button size="sm" disabled={mode !== "live"} onClick={() => control("HOLD")}>
                  Hold
                </Button>
                <Button size="sm" disabled title="Transfer is not supported by the mock provider">
                  Transfer
                </Button>
                <Button size="sm" variant="danger" disabled={mode !== "live"} onClick={() => control("END")}>
                  End
                </Button>
              </div>
            </section>
          )}

          {(mode === "dialing" || mode === "live") && ctx.customer && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="kpi">
                  <span className="kpi-label">Overdue now</span>
                  <span className="kpi-value">{fmtAzn(ctx.customer.summary.overdueDueNow, false)}</span>
                  <span className="kpi-note">AZN - oldest due {fmtDate(ctx.customer.loans.find((l) => l.oldestUnpaidDueDate)?.oldestUnpaidDueDate ?? null)}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Principal outstanding</span>
                  <span className="kpi-value">{fmtAzn(ctx.customer.summary.principalOutstanding, false)}</span>
                  <span className="kpi-note">AZN - authoritative projection</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Current DPD</span>
                  <span className="kpi-value">{ctx.customer.summary.maxDpd}</span>
                  <span className="kpi-note">All related loans visible</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Next installment</span>
                  <span className="kpi-value">{ctx.customer.summary.nextDue ? fmtDate(ctx.customer.summary.nextDue.date) : "—"}</span>
                  <span className="kpi-note">{ctx.customer.summary.nextDue ? `${fmtAzn(ctx.customer.summary.nextDue.amount, false)} AZN / regular annuity` : ""}</span>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_1fr]">
                <Card>
                  <CustomerContext ctx={ctx} verified={verified} />
                </Card>
                <Card>
                  <ScriptPanel ctx={ctx} verified={verified} thirdParty={thirdParty} agentName={user.displayName} />
                </Card>
                <Card title="Responses / draft" subtitle="Structured dropdowns and conditional fields">
                  {mode === "live" && interaction ? <OutcomeForm ctx={ctx} draft={draft} onChange={setDraft} onPreview={setPreview} compact serverNow={serverNow} /> : <p className="text-sm text-muted">Responses open when the customer is connected.</p>}
                </Card>
              </div>
            </>
          )}

          {mode === "recovery" && <Callout tone="warning">Correlation {reservation?.correlationId}. Do not use data from any other customer. If the call connects, use the provider controls; the context will load when the trusted ids resolve.</Callout>}

          {mode === "acw" && ctx.customer && interaction && (
            <AfterCallWork
              ctx={ctx}
              draft={draft}
              setDraft={setDraft}
              preview={preview}
              setPreview={setPreview}
              serverNow={serverNow}
              acwElapsed={acwElapsed}
              onSaved={() => {
                setToast({ message: "Outcome saved; synchronizing provider wrap-up.", tone: "success" });
                void refreshFull();
              }}
            />
          )}

          {mode === "wrapup" && interaction && (
            <Card title="Wrap-up synchronization" subtitle="Business save succeeded; provider acknowledgment is a separate state">
              <dl className="dl-grid">
                <dt>Interaction</dt>
                <dd>{interaction.correlationId}</dd>
                <dt>Business outcome</dt>
                <dd className="text-success">Saved at {fmtDateTime(interaction.savedAt, true)}</dd>
                <dt>Provider wrap-up</dt>
                <dd className={interaction.wrapUpStatus === "FAILED" ? "text-danger" : "text-warning"}>{interaction.wrapUpStatus === "FAILED" ? "Not acknowledged - retrying idempotently; supervisor can assist" : "Pending acknowledgment"}</dd>
                <dt>Next voice assignment</dt>
                <dd className="text-warning">Blocked until confirmed</dd>
              </dl>
              {!ctx.workerOnline && <Callout tone="danger" className="mt-3">The background worker is offline; the wrap-up command is queued in the outbox.</Callout>}
            </Card>
          )}

          {mode === "home" && (
            <>
              {focus === "call" && <Callout tone="info">No active call. The next eligible customer is allocated automatically once you are confirmed Ready.</Callout>}
              <HomePanels ctx={ctx} />
            </>
          )}
        </>
      )}
    </div>
  );
}
