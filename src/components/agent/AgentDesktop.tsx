"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Callout, Toast } from "@/components/ui";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at, errorText } from "@/i18n/agentText";
import type { AgentContext, OutcomeDraft } from "@/components/agent/types";
import { api, useAgentStream } from "@/components/agent/useAgentStream";
import { CallHeader, type CallAction } from "@/components/agent/CallHeader";
import { modeOf } from "@/components/agent/mode";
import { ConversationFlow, type PreviewResult } from "@/components/agent/ConversationFlow";
import { CustomerPanel } from "@/components/agent/CustomerPanel";
import { ActionBar } from "@/components/agent/ActionBar";
import { openedKey } from "@/components/shell/ActiveCallIndicator";

export interface AgentUser {
  id: string;
  displayName: string;
  roleLabel: string;
  teamName: string | null;
  languages: string[];
  manualDialAllowed: boolean;
}

type Tone = "info" | "success" | "danger" | "warning";

/**
 * The call workspace (/agent/call). One compact header; the conversation (script passages with their answers) on the
 * left; the customer summary and details on the right; a slim bar for the single final save. Every state shown is
 * provider-confirmed and every timer runs on the server clock. The draft is the one held on the server: a reload, a
 * reconnect or a visit to another page returns to the same answers and stage.
 */
export function AgentDesktop({ initial, user, locale, showDiagnostics }: { initial: AgentContext | null; user: AgentUser; locale: Locale; showDiagnostics: boolean }) {
  const A = (k: string, v?: Record<string, string | number>) => at(locale, k, v);
  const T = (k: string) => t(locale, k);
  const { ctx, connected, serverNow, refreshFull } = useAgentStream(initial);
  const [busy, setBusy] = useState(false);
  const [controlBusy, setControlBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const [draft, setDraft] = useState<OutcomeDraft>({});
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  // The draft is taken from the server once per interaction; later stream updates never overwrite local edits.
  const interaction = ctx?.interaction ?? null;
  if ((interaction?.id ?? null) !== draftFor) {
    setDraftFor(interaction?.id ?? null);
    setDraft((interaction?.draft as OutcomeDraft | null) ?? {});
    setPreview(null);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(id);
  }, [toast]);
  const latestNotification = ctx?.notifications?.[0] ?? null;
  const [notifiedId, setNotifiedId] = useState<string | null>(null);
  if (latestNotification && latestNotification.id !== notifiedId) {
    setNotifiedId(latestNotification.id);
    const localized = A(`note.${latestNotification.kind}`);
    setToast({ message: localized === `note.${latestNotification.kind}` ? latestNotification.message : localized, tone: latestNotification.kind === "PAYMENT_CLEARED_DURING_CALL" ? "success" : "info" });
  }
  useEffect(() => {
    if (!latestNotification) return;
    void fetch("/api/agent/notifications/read", { method: "POST" });
  }, [latestNotification]);

  const session = ctx?.session ?? null;
  const reservation = ctx?.reservation ?? null;
  // Once this workspace has shown a call, the dashboard never moves the agent here again for the same call.
  const shownCall = reservation?.id ?? interaction?.id ?? null;
  useEffect(() => {
    if (!shownCall) return;
    try {
      sessionStorage.setItem(openedKey(shownCall), "1");
    } catch {
      // Storage unavailable (private mode): the indicator still works; at most one automatic move per call.
    }
  }, [shownCall]);
  const say = (message: string, tone: Tone = "info") => setToast({ message, tone });

  async function connect() {
    setBusy(true);
    const r = await api("/api/agent/session");
    setBusy(false);
    if (!r.ok) say(errorText(locale, r.error), "danger");
    else await refreshFull();
  }
  async function changeState(state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) {
    setBusy(true);
    const r = await api<{ deferred: boolean }>("/api/agent/state", { state, reason: reason ?? null });
    setBusy(false);
    if (!r.ok) say(errorText(locale, r.error), "danger");
    else if (r.data.deferred) say(A("toast.deferred", { state: T(`agent.states.${state}`) }), "warning");
    if (state === "OFFLINE" && r.ok && !r.data.deferred) setTimeout(() => void refreshFull(), 1500);
  }
  async function control(action: CallAction) {
    if (!interaction || controlBusy) return;
    setControlBusy(action);
    const r = await api<{ requested: boolean; status: string }>("/api/agent/call-control", { interactionId: interaction.id, action });
    setControlBusy(null);
    if (!r.ok) say(errorText(locale, r.error), "danger");
    await refreshFull();
  }

  const callElapsed = useMemo(() => {
    void tick;
    if (interaction?.connectedAt && !interaction.endedAt) return Math.max(0, Math.round((serverNow().getTime() - new Date(interaction.connectedAt).getTime()) / 1000));
    if (reservation?.attempt?.startedAt && !reservation.attempt.endedAt) return Math.max(0, Math.round((serverNow().getTime() - new Date(reservation.attempt.startedAt).getTime()) / 1000));
    return 0;
  }, [tick, interaction, reservation, serverNow]);
  const acwElapsed = useMemo(() => {
    void tick;
    return interaction?.acwStartedAt ? Math.max(0, Math.round((serverNow().getTime() - new Date(interaction.acwStartedAt).getTime()) / 1000)) : 0;
  }, [tick, interaction, serverNow]);

  if (!ctx) return <p className="text-muted">{T("common.loading")}</p>;
  const mode = modeOf(ctx);
  const confirmed = session?.confirmedState ?? "OFFLINE";
  const verified = draft.identityStatus === "RPC_VERIFIED";
  // Calls are only placed while something is overdue, so nothing overdue during the conversation means a verified payment cleared it.
  const overdueCleared = (mode === "live" || mode === "acw") && !!ctx.customer && Number(ctx.customer.summary.overdueDueNow) <= 0;

  if (mode === "connect") {
    return (
      <div className="space-y-3">
        <Toast message={toast?.message ?? null} tone={toast?.tone} />
        <section className="panel space-y-3 p-5">
          <h2 className="text-lg font-semibold">{T("agent.workspace")}</h2>
          <p className="text-sm text-muted">{A("conn.lead")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={connect} disabled={busy} data-testid="connect-dialer">
              {busy ? T("agent.connecting") : T("agent.connect")}
            </Button>
            <span className="text-[13px] text-muted">{user.displayName} · {user.teamName ?? "—"}</span>
          </div>
          {!ctx.workerOnline && <Callout tone="danger">{A("conn.workerOffline")}</Callout>}
        </section>
      </div>
    );
  }

  const inConversation = (mode === "dialing" || mode === "live" || mode === "acw") && !!ctx.customer;
  return (
    <div className="space-y-3" data-testid="call-workspace" data-mode={mode}>
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
      <CallHeader ctx={ctx} locale={locale} mode={mode} serverNow={serverNow} busy={busy} onState={changeState} onControl={control} controlBusy={controlBusy} showDiagnostics={showDiagnostics} callElapsed={callElapsed} acwElapsed={acwElapsed} />
      {!connected && <p className="callout callout-warning text-sm">{A("conn.reconnecting")}</p>}
      {confirmed === "CONNECTION_PROBLEM" && <p className="callout callout-danger text-sm">{A("conn.problem")}</p>}
      {!ctx.workerOnline && mode !== "home" && <p className="callout callout-danger text-sm">{A("conn.workerOffline")}</p>}
      {mode === "recovery" && <p className="callout callout-warning text-sm">{A("dial.recovery")}</p>}

      {inConversation && (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0 space-y-3">
              {overdueCleared && <p className="callout callout-success text-sm font-medium" data-testid="overdue-cleared-banner">{A("cleared.banner")}</p>}
              {mode === "acw" && interaction && (
                <p className="callout callout-warning text-sm" data-testid="acw-strip">
                  {A("acw.lead", { at: fmtDateTime(interaction.endedAt, false, locale) })} {interaction.talkSeconds ? `· ${A("acw.talk", { d: fmtDuration(interaction.talkSeconds) })}` : ""}
                </p>
              )}
              {mode === "dialing" || !interaction ? (
                <section className="stage p-4" data-testid="dialing-state">
                  <p className="text-sm text-muted">{reservation?.status === "DIALING" ? A("dial.lead") : A("dial.reserved")}</p>
                </section>
              ) : (
                <ConversationFlow key={interaction.id} ctx={ctx} locale={locale} draft={draft} onChange={setDraft} onPreview={setPreview} serverNow={serverNow} agentName={user.displayName} active={mode === "live" || mode === "acw"} />
              )}
            </div>
            <CustomerPanel ctx={ctx} locale={locale} verified={verified} showDiagnostics={showDiagnostics} onToast={say} onSent={() => void refreshFull()} />
          </div>
          {(mode === "live" || mode === "acw") && interaction && <ActionBar ctx={ctx} locale={locale} draft={draft} preview={preview} callActive={mode === "live"} onSaved={() => { say(A("toast.saved"), "success"); void refreshFull(); }} />}
        </>
      )}

      {mode === "wrapup" && interaction && (
        <section className="panel space-y-2 p-5" data-testid="wrapup-state">
          <h2 className="text-lg font-semibold">{A("wrap.title")}</h2>
          <p className="text-sm text-muted">{A("wrap.lead")}</p>
          <p className="text-sm text-success">{A("wrap.saved", { at: fmtDateTime(interaction.savedAt, false, locale), outcome: interaction.businessOutcome ? T(`agent.outcomes.${interaction.businessOutcome}`) : "—" })}</p>
          <p className={`text-sm ${interaction.wrapUpStatus === "FAILED" ? "text-danger" : "text-warning"}`}>{interaction.wrapUpStatus === "FAILED" ? A("wrap.failed") : A("wrap.pending")}</p>
          {showDiagnostics && <p className="text-[13px] text-muted">{interaction.correlationId}</p>}
        </section>
      )}

      {mode === "home" && (
        <section className="panel space-y-2 p-5" data-testid="idle-state">
          <h2 className="text-lg font-semibold">{A("idle.title")}</h2>
          <p className="text-sm text-muted">{confirmed === "READY" ? A("idle.waiting") : confirmed === "NOT_READY" || confirmed === "BREAK" ? A("idle.notReady") : A("idle.lead")}</p>
          <Link href="/agent" className="text-sm">{A("idle.toDashboard")} →</Link>
        </section>
      )}
    </div>
  );
}
