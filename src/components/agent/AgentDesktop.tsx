"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, Callout, Card, Toast } from "@/components/ui";
import { fmtDateTime, humanize } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api, useAgentStream } from "@/components/agent/useAgentStream";
import { CompactHeader, type CallAction, type Mode } from "@/components/agent/CompactHeader";
import { HomePanels } from "@/components/agent/HomePanels";
import { DetailsTabs } from "@/components/agent/DetailsTabs";
import { ScriptPanel } from "@/components/agent/ScriptPanel";
import { OutcomeForm, type PreviewResult } from "@/components/agent/OutcomeForm";
import { AfterCallWork } from "@/components/agent/AfterCallWork";
import { ActionBar } from "@/components/agent/ActionBar";

export interface AgentUser {
  id: string;
  displayName: string;
  roleLabel: string;
  teamName: string | null;
  languages: string[];
  manualDialAllowed: boolean;
}

/**
 * Agent workspace (S28): one compact header for every state, the script and structured answers as the main
 * reading area, details in tabs on the right, and a sticky action bar for the single final save. All timers are
 * anchored on the server clock; every state shown is provider-confirmed; diagnostics are hidden from agents.
 */
export function AgentDesktop({ initial, user, focus, locale, showDiagnostics }: { initial: AgentContext | null; user: AgentUser; focus?: "home" | "call"; locale: Locale; showDiagnostics: boolean }) {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const { ctx, connected, serverNow, refreshFull } = useAgentStream(initial);
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "success" | "danger" | "warning" } | null>(null);
  const [draft, setDraft] = useState<OutcomeDraft>({});
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // Hydrate the recoverable draft from the backend when a new interaction appears (refresh/reconnect safe).
  const currentInteraction = ctx?.interaction ?? null;
  if ((currentInteraction?.id ?? null) !== draftFor) {
    setDraftFor(currentInteraction?.id ?? null);
    setDraft((currentInteraction?.draft as OutcomeDraft | null) ?? {});
    setPreview(null);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);
  const latestNotification = ctx?.notifications?.[0] ?? null;
  const [notifiedId, setNotifiedId] = useState<string | null>(null);
  if (latestNotification && latestNotification.id !== notifiedId) {
    setNotifiedId(latestNotification.id);
    setToast({ message: latestNotification.message, tone: latestNotification.kind === "PAYMENT_CLEARED_DURING_CALL" ? "success" : "info" });
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
  const say = (message: string, tone: "info" | "success" | "danger" | "warning" = "info") => setToast({ message, tone });

  async function connect() {
    setBusy(true);
    const r = await api("/api/agent/session");
    setBusy(false);
    if (!r.ok) say(r.error.message, "danger");
    else await refreshFull();
  }
  async function changeState(state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) {
    setBusy(true);
    const r = await api<{ deferred: boolean }>("/api/agent/state", { state, reason: reason ?? null });
    setBusy(false);
    if (!r.ok) say(r.error.message, "danger");
    else if (r.data.deferred) say(`${tt(`agent.states.${state}`)}: ${tt("agent.breakAfterWrap").toLowerCase()}`, "warning");
    if (state === "OFFLINE" && r.ok && !r.data.deferred) setTimeout(() => void refreshFull(), 1500);
  }
  async function control(action: CallAction) {
    if (!interaction) return;
    setControlBusy(action);
    const r = await api<{ status: string; pending?: boolean }>("/api/agent/call-control", { interactionId: interaction.id, action });
    setControlBusy(null);
    if (!r.ok) say(r.error.message, "danger");
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

  if (!ctx) return <p className="text-muted">{tt("common.loading")}</p>;

  const mode: Mode =
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
  const controlState = interaction?.controlState ?? null;
  const overdueCleared = mode === "live" && !!ctx.customer && Number(ctx.customer.summary.overdueDueNow) <= 0;

  if (mode === "connect") {
    return (
      <div className="space-y-3">
        <Toast message={toast?.message ?? null} tone={toast?.tone} />
        <Card title={tt("agent.workspace")} subtitle={tt("agent.connectHint")}>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={connect} disabled={busy} data-testid="connect-dialer">{busy ? tt("agent.connecting") : tt("agent.connect")}</Button>
            <span className="text-xs text-muted">{user.displayName} · {user.roleLabel} · {user.teamName ?? "—"} · {user.languages.join("/")}</span>
          </div>
          {!ctx.workerOnline && <Callout tone="danger" className="mt-3">{tt("agent.workerOffline")}</Callout>}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
      <CompactHeader ctx={ctx} locale={locale} mode={mode} user={user} serverNow={serverNow} busy={busy} onState={changeState} onControl={control} controlBusy={controlBusy} showDiagnostics={showDiagnostics} callElapsed={callElapsed} verified={verified} />
      {!connected && <Callout tone="warning">{tt("agent.reconnecting")}</Callout>}
      {confirmed === "CONNECTION_PROBLEM" && <Callout tone="danger">{tt("agent.connectionProblem")} {session?.stateReason}</Callout>}
      {!ctx.workerOnline && mode !== "home" && <Callout tone="danger">{tt("agent.workerOffline")}</Callout>}
      {controlState?.lastError && (mode === "live" || mode === "dialing") && (
        <Callout tone="danger">
          {tt("agent.alerts.controlError", { error: controlState.lastError })} · {tt("agent.controls.forceEndHint")}
          {showDiagnostics && controlState.lastErrorAt ? ` (${fmtDateTime(controlState.lastErrorAt, true)})` : ""}
        </Callout>
      )}
      {overdueCleared && <Callout tone="success" className="font-medium" data-testid="overdue-cleared-banner">{tt("agent.alerts.overdueCleared")}</Callout>}
      {mode === "recovery" && <Callout tone="warning">{tt("agent.alerts.recovery")}</Callout>}

      {(mode === "dialing" || mode === "live") && ctx.customer && (
        <>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <Card>
                <ScriptPanel ctx={ctx} locale={locale} verified={verified} thirdParty={thirdParty} agentName={user.displayName} showDiagnostics={showDiagnostics} />
              </Card>
              <Card title={tt("agent.tabs.responses")}>
                {mode === "live" && interaction ? <OutcomeForm ctx={ctx} locale={locale} draft={draft} onChange={setDraft} onPreview={setPreview} serverNow={serverNow} /> : <p className="text-sm text-muted">{tt("agent.callModes.dialing")}…</p>}
              </Card>
            </div>
            <Card>
              <DetailsTabs ctx={ctx} locale={locale} verified={verified} showDiagnostics={showDiagnostics} onToast={say} onSent={() => void refreshFull()} />
            </Card>
          </div>
          {mode === "live" && interaction && <ActionBar ctx={ctx} locale={locale} draft={draft} preview={preview} callActive onSaved={() => void refreshFull()} />}
        </>
      )}

      {mode === "acw" && ctx.customer && interaction && (
        <AfterCallWork ctx={ctx} locale={locale} draft={draft} setDraft={setDraft} preview={preview} setPreview={setPreview} serverNow={serverNow} acwElapsed={acwElapsed} showDiagnostics={showDiagnostics} onToast={say} onRefresh={() => void refreshFull()} onSaved={() => { say(tt("agent.acw.savedWaiting"), "success"); void refreshFull(); }} />
      )}

      {mode === "wrapup" && interaction && (
        <Card title={tt("agent.wrapup.title")} subtitle={tt("agent.wrapup.lead")}>
          <dl className="dl-grid">
            {showDiagnostics && (<><dt>Interaction</dt><dd>{interaction.correlationId}</dd></>)}
            <dt>{tt("agent.wrapup.business")}</dt>
            <dd className="text-success">{tt("agent.wrapup.savedAt")} {fmtDateTime(interaction.savedAt, true)} · {interaction.businessOutcome ? tt(`agent.outcomes.${interaction.businessOutcome}`) : humanize(interaction.businessOutcome)}</dd>
            <dt>{tt("agent.wrapup.provider")}</dt>
            <dd className={interaction.wrapUpStatus === "FAILED" ? "text-danger" : "text-warning"}>{interaction.wrapUpStatus === "FAILED" ? tt("agent.wrapup.failed") : tt("agent.wrapup.pending")}</dd>
            <dt>{tt("agent.wrapup.nextVoice")}</dt>
            <dd className="text-warning">{tt("agent.wrapup.blocked")}</dd>
          </dl>
        </Card>
      )}

      {mode === "home" && (
        <>
          {focus === "call" && <Callout tone="info">{tt("agent.alerts.noActiveCall")}</Callout>}
          <HomePanels ctx={ctx} locale={locale} />
        </>
      )}
    </div>
  );
}
