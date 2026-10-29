"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Dialog, Field, Input, type Tone } from "@/components/ui";
import { fmtAzn, fmtDuration } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import type { AgentContext } from "@/components/agent/types";

const STATE_TONE: Record<string, string> = { READY: "ok", TALKING: "ok", RESERVED: "info", DIALING: "info", ACW: "warn", NOT_READY: "warn", BREAK: "", OFFLINE: "", CONNECTION_PROBLEM: "bad" };
export type CallAction = "MUTE" | "UNMUTE" | "HOLD" | "RESUME" | "END";
export type Mode = "connect" | "home" | "dialing" | "live" | "acw" | "wrapup" | "recovery";

function Chip({ tone, children, title, testId }: { tone: "ok" | "warn" | "bad" | "info" | ""; children: React.ReactNode; title?: string; testId?: string }) {
  return (
    <span className={`state-chip ${tone ? `state-chip-${tone}` : ""}`} title={title} data-testid={testId}>
      {children}
    </span>
  );
}

/**
 * One compact header for every agent state: provider-confirmed state and timer, the customer in one line with
 * positive eligibility labels ("Məlumat aktualdır", "Əlaqəyə icazə var"), capability-driven call controls with
 * pending/error feedback, and the availability actions. Diagnostics (ids, refs) appear only for supervising roles.
 */
export function CompactHeader({ ctx, locale, mode, user, serverNow, busy, onState, onControl, controlBusy, showDiagnostics, callElapsed, verified }: {
  ctx: AgentContext;
  locale: Locale;
  mode: Mode;
  user: { displayName: string; roleLabel: string; teamName: string | null; languages: string[] };
  serverNow: () => Date;
  busy: boolean;
  onState: (state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) => Promise<void>;
  onControl: (action: CallAction) => Promise<void>;
  controlBusy: string | null;
  showDiagnostics: boolean;
  callElapsed: number;
  verified: boolean;
}) {
  const tt = (k: string, v?: Record<string, string | number>) => t(locale, k, v);
  const s = ctx.session;
  const c = ctx.customer;
  const i = ctx.interaction;
  const r = ctx.reservation;
  const [elapsed, setElapsed] = useState(0);
  const [breakOpen, setBreakOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const id = setInterval(() => setElapsed(s ? Math.round((serverNow().getTime() - new Date(s.stateSince).getTime()) / 1000) : 0), 1000);
    return () => clearInterval(id);
  }, [s, serverNow]);
  const confirmed = s?.confirmedState ?? "OFFLINE";
  const pendingWrap = !!i && (i.status === "DRAFT" || i.status === "OPEN" || i.wrapUpStatus === "PENDING" || i.wrapUpStatus === "FAILED");
  const busyState = ["RESERVED", "DIALING", "TALKING", "ACW"].includes(confirmed) || !!r;
  const canReady = !!s && s.ctiConnected && !busyState && !pendingWrap && confirmed !== "READY" && !busy;
  const caps = ctx.capabilities;
  const control = i?.controlState;
  const pending = (a: string) => !!control?.pending.some((p) => p.action === a);
  const live = mode === "live";
  const staleMs = c?.summary.balancesAsOf ? serverNow().getTime() - new Date(c.summary.balancesAsOf).getTime() : null;
  const dataCurrent = staleMs !== null && staleMs < 15 * 60_000;
  const contactAllowed = c ? c.restrictions.openDisputes.length === 0 && c.restrictions.supportCases.length === 0 && !c.customer.specialHandling : false;
  const callLabel = live ? `${tt("agent.callModes.connected")} · ${fmtDuration(callElapsed)}` : r?.attempt?.ringingAt ? `${tt("agent.callModes.ringing")} · ${fmtDuration(callElapsed)}` : r?.status === "DIALING" ? `${tt("agent.callModes.dialing")} · ${fmtDuration(callElapsed)}` : mode === "acw" ? tt("agent.callModes.acw") : mode === "wrapup" ? tt("agent.callModes.wrapup") : mode === "recovery" ? tt("agent.callModes.recovery") : tt("agent.callModes.reserved");
  return (
    <header className="compact-header" aria-label="Agent header" data-testid="compact-header">
      <div className="flex items-center gap-2">
        <Chip tone={(STATE_TONE[confirmed] ?? "") as "ok"} title="Provider-confirmed state" testId="agent-state">
          {tt(`agent.states.${confirmed}`)}
          <span className="tabular-nums text-muted">{fmtDuration(elapsed)}</span>
        </Chip>
        {s && s.requestedState !== confirmed && !busyState && <Chip tone="info">→ {tt(`agent.states.${s.requestedState}`)} {tt("agent.requested")}</Chip>}
        {s?.pendingBreakAfterWrap && <Chip tone="warn">{tt("agent.breakAfterWrap")}</Chip>}
      </div>
      {c && mode !== "home" && (
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="hdr-name truncate">
              <Link href={`/customers/${c.customer.id}`}>{c.customer.displayName}</Link>
            </span>
            <span className="hdr-meta">
              {c.customer.cif} · {c.customer.language} · {c.summary.activeLoans} {tt("agent.facts.loans").toLowerCase()} · {tt("agent.facts.dpd")} {c.summary.maxDpd}
            </span>
            <span className="text-sm font-semibold text-danger tabular-nums">{fmtAzn(c.summary.overdueDueNow)}</span>
            <Chip tone={dataCurrent ? "ok" : "warn"} title={c.summary.balancesAsOf ? new Date(c.summary.balancesAsOf).toLocaleString() : undefined}>{dataCurrent ? tt("agent.eligibility.dataCurrent") : tt("agent.eligibility.dataStale")}</Chip>
            <Chip tone={contactAllowed ? "ok" : "warn"}>{contactAllowed ? tt("agent.eligibility.contactAllowed") : tt("agent.eligibility.contactBlocked")}</Chip>
            <Chip tone={verified ? "ok" : ""} testId="identity-chip">{verified ? tt("agent.eligibility.verified") : tt("agent.eligibility.unverified")}</Chip>
            <Chip tone={live ? "ok" : "info"} testId="call-strip">{callLabel}</Chip>
            {r?.withdrawalStatus === "REQUESTED" && <Chip tone="warn">{tt("agent.alerts.withdrawal")}</Chip>}
          </div>
          {showDiagnostics && (
            <p className="hdr-meta mt-0.5">
              {i?.correlationId ?? r?.correlationId} · {r?.campaignCode ?? "—"} · {r?.maskedNumber ?? "number masked"} · provider {i?.providerInteractionRef ?? "—"} · {control?.providerState ?? "—"}
            </p>
          )}
        </div>
      )}
      {!c && mode === "home" && (
        <div className="min-w-0 flex-1 hdr-meta">
          <span className="font-medium text-ink">{user.displayName}</span> · {user.roleLabel} · {user.teamName ?? "—"} · {user.languages.join("/")} · Ext {s?.extension ?? "—"} ·{" "}
          <span className={s?.ctiConnected ? "text-success" : "text-danger"}>{s?.ctiConnected ? tt("agent.ctiConnected") : tt("agent.ctiNot")}</span> ·{" "}
          <span className={ctx.workerOnline ? "text-success" : "text-danger"}>{ctx.workerOnline ? tt("agent.workerOk") : tt("agent.workerOffline")}</span>
          {s?.stateReason && <span className="ml-2 text-warning">· {s.stateReason}</span>}
        </div>
      )}
      {(mode === "dialing" || mode === "live" || mode === "recovery") && (
        <div className="flex items-center gap-1" aria-label="Call controls" data-testid="call-controls">
          {caps.mute && <Button size="sm" disabled={!live || !!controlBusy || pending("MUTE") || pending("UNMUTE")} onClick={() => onControl(control?.muted ? "UNMUTE" : "MUTE")} aria-pressed={!!control?.muted} data-testid="ctl-mute">{pending("MUTE") || pending("UNMUTE") ? `${control?.muted ? tt("agent.controls.unmute") : tt("agent.controls.mute")}…` : control?.muted ? tt("agent.controls.unmute") : tt("agent.controls.mute")}</Button>}
          {caps.hold && <Button size="sm" disabled={!live || !!controlBusy || pending("HOLD") || pending("RESUME")} onClick={() => onControl(control?.held ? "RESUME" : "HOLD")} aria-pressed={!!control?.held} data-testid="ctl-hold">{pending("HOLD") || pending("RESUME") ? `${control?.held ? tt("agent.controls.resume") : tt("agent.controls.hold")}…` : control?.held ? tt("agent.controls.resume") : tt("agent.controls.hold")}</Button>}
          {caps.transfer ? <Button size="sm" disabled>{tt("agent.controls.transfer")}</Button> : showDiagnostics ? <Button size="sm" disabled title={tt("agent.controls.unsupported")}>{tt("agent.controls.transfer")}</Button> : null}
          {caps.end && <Button size="sm" variant="danger" disabled={!live || !!controlBusy || pending("END")} onClick={() => onControl("END")} data-testid="ctl-end">{pending("END") ? `${tt("agent.controls.end")}…` : tt("agent.controls.end")}</Button>}
        </div>
      )}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {mode === "home" && (
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={!!s?.autoContinue} disabled={!s || busy} onChange={(e) => void fetch("/api/agent/auto-continue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: e.target.checked }) })} />
            {tt("agent.autoContinue")}
          </label>
        )}
        <Button variant="primary" size="sm" disabled={!canReady} onClick={() => onState("READY")} title={pendingWrap ? tt("agent.review.endFirst") : undefined} data-testid="go-ready">{tt("agent.goReady")}</Button>
        <Button variant="secondary" size="sm" disabled={!s || busy || confirmed === "NOT_READY"} onClick={() => onState("NOT_READY")}>{tt("agent.notReady")}</Button>
        <Button variant="secondary" size="sm" disabled={!s || busy || confirmed === "BREAK"} onClick={() => setBreakOpen(true)}>{tt("agent.break")}</Button>
        <Button variant="ghost" size="sm" disabled={!s || busy} onClick={() => onState("OFFLINE", "End of shift")}>{tt("agent.endShift")}</Button>
      </div>
      <Dialog open={breakOpen} onClose={() => setBreakOpen(false)} title={tt("agent.break")}>
        <Field label={tt("agent.breakReason")} htmlFor="break-reason" required>
          <Input id="break-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={!reason.trim()} onClick={async () => { setBreakOpen(false); await onState("BREAK", reason.trim()); setReason(""); }}>{tt("agent.confirmBreak")}</Button>
          <Button onClick={() => setBreakOpen(false)}>{tt("common.cancel")}</Button>
        </div>
      </Dialog>
    </header>
  );
}

export const TONE_BY_STATE: Record<string, Tone> = { READY: "success", TALKING: "success", RESERVED: "info", DIALING: "info", ACW: "warning", NOT_READY: "warning", BREAK: "neutral", OFFLINE: "neutral", CONNECTION_PROBLEM: "danger" };
