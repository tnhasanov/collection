"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { t, type Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";
import { summarizeControlState, type CallControlState } from "@/server/modules/dialer/contract";
import type { AgentContext } from "@/components/agent/types";

export type CallAction = "MUTE" | "UNMUTE" | "HOLD" | "RESUME" | "END" | "RECONCILE";
export type Mode = "connect" | "home" | "dialing" | "live" | "acw" | "wrapup" | "recovery";

const STATE_DOT: Record<string, string> = { READY: "bg-success", TALKING: "bg-success", RESERVED: "bg-info", DIALING: "bg-info", ACW: "bg-warning", NOT_READY: "bg-warning", BREAK: "bg-muted", OFFLINE: "bg-muted", CONNECTION_PROBLEM: "bg-danger" };

/** Small disclosure that keeps details out of the header until asked for. */
function Popover({ label, children, testId, className }: { label: React.ReactNode; children: React.ReactNode; testId?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={className ?? "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-canvas"} aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={testId}>
        {label}
      </button>
      {open && <div className="popover right-0 lg:left-0 lg:right-auto" role="dialog">{children}</div>}
    </div>
  );
}

/**
 * Compact call header: who (name, CIF), how much (overdue, DPD), what is happening (provider-confirmed call status and
 * timer), whether the data can be trusted (one word, details on demand), the call controls, and — visually separate —
 * the shift controls. An unresolved End shows its recovery actions here, close to the control it concerns.
 */
export function CallHeader(p: {
  ctx: AgentContext;
  locale: Locale;
  mode: Mode;
  serverNow: () => Date;
  busy: boolean;
  onState: (state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) => Promise<void>;
  onControl: (action: CallAction) => Promise<void>;
  controlBusy: string | null;
  showDiagnostics: boolean;
  callElapsed: number;
  acwElapsed: number;
}) {
  const { ctx, locale, mode } = p;
  const A = (k: string, v?: Record<string, string | number>) => at(locale, k, v);
  const T = (k: string) => t(locale, k);
  const s = ctx.session;
  const c = ctx.customer;
  const i = ctx.interaction;
  const r = ctx.reservation;
  const [breakOpen, setBreakOpen] = useState(false);
  const [reason, setReason] = useState("");
  // The workspace re-renders every second, so the state timer is derived from the server clock at render time.
  const stateElapsed = s ? Math.max(0, Math.round((p.serverNow().getTime() - new Date(s.stateSince).getTime()) / 1000)) : 0;
  const confirmed = s?.confirmedState ?? "OFFLINE";
  const inCall = mode === "dialing" || mode === "live" || mode === "recovery";
  const pendingWrap = !!i && (i.status === "DRAFT" || i.status === "OPEN" || i.wrapUpStatus === "PENDING" || i.wrapUpStatus === "FAILED");
  const busyState = ["RESERVED", "DIALING", "TALKING", "ACW"].includes(confirmed) || !!r;
  const canReady = !!s && s.ctiConnected && !busyState && !pendingWrap && confirmed !== "READY" && !p.busy;
  const caps = ctx.capabilities;
  const control = i?.controlState ? summarizeControlState(i.controlState as unknown as CallControlState, p.serverNow()) : null;
  const pending = (a: string) => !!control?.pendingActions.includes(a as never);
  const live = mode === "live";
  const balancesAt = c?.summary.balancesAsOf ? new Date(c.summary.balancesAsOf) : null;
  const dataCurrent = !!balancesAt && p.serverNow().getTime() - balancesAt.getTime() < 15 * 60_000;
  const contactAllowed = c ? c.restrictions.openDisputes.length === 0 && c.restrictions.supportCases.length === 0 && !c.customer.specialHandling : true;
  const telMode = ctx.capabilities.mode;
  const status = live
    ? { label: A("call.talking"), time: p.callElapsed, dot: "bg-success" }
    : mode === "dialing"
      ? { label: r?.attempt?.ringingAt ? A("call.ringing") : r?.status === "DIALING" ? A("call.dialing") : A("call.reserved"), time: p.callElapsed, dot: "bg-info" }
      : mode === "acw"
        ? { label: A("call.acw"), time: p.acwElapsed, dot: "bg-warning" }
        : mode === "wrapup"
          ? { label: A("call.wrapup"), time: null, dot: "bg-warning" }
          : mode === "recovery"
            ? { label: A("call.recovery"), time: null, dot: "bg-danger" }
            : { label: A("call.noCall"), time: null, dot: "bg-muted" };
  const endFailed = !!control?.end && control.end.status === "FAILED" && i?.status === "OPEN";
  const endStale = !!control?.end && control.end.stale && i?.status === "OPEN";

  const statusTone = live ? "text-success" : mode === "acw" || mode === "wrapup" ? "text-warning" : mode === "recovery" ? "text-danger" : mode === "dialing" ? "text-info" : "text-muted";
  const activeLoans = c ? c.loans.filter((l) => l.status === "ACTIVE").length : 0;
  const shift = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={A("call.shift")} data-testid="shift-controls">
      {!inCall && mode !== "acw" && mode !== "wrapup" && (
        <span className="mr-1 inline-flex items-center gap-1.5 text-sm" data-testid="agent-state">
          <span className={`inline-block h-2 w-2 rounded-full ${STATE_DOT[confirmed] ?? "bg-muted"}`} aria-hidden="true" />
          <span className="text-ink">{T(`agent.states.${confirmed}`)}</span>
          <span className="tabular-nums text-muted">{fmtDuration(stateElapsed)}</span>
        </span>
      )}
      {s?.pendingBreakAfterWrap && <span className="text-xs text-warning">{T("agent.breakAfterWrap")}</span>}
      {!inCall && mode !== "acw" && mode !== "wrapup" && (
        <Button variant="primary" disabled={!canReady} onClick={() => p.onState("READY")} data-testid="go-ready">
          {T("agent.goReady")}
        </Button>
      )}
      {confirmed === "READY" && <Button variant="secondary" disabled={!s || p.busy} onClick={() => p.onState("NOT_READY")}>{T("agent.notReady")}</Button>}
      <Button variant="secondary" disabled={!s || p.busy || confirmed === "BREAK"} onClick={() => setBreakOpen(true)} data-testid="shift-break">
        {T("agent.break")}
      </Button>
      <Button variant="ghost" disabled={!s || p.busy} onClick={() => p.onState("OFFLINE", "End of shift")} data-testid="shift-end">
        {T("agent.endShift")}
      </Button>
    </div>
  );
  const withCustomer = !!c && mode !== "home";

  return (
    <header aria-label={A("nav.activeCall")} data-testid="compact-header">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        {withCustomer ? (
          <div className="min-w-0" data-testid="header-customer">
            <h1 className="page-title truncate">
              <Link href={`/customers/${c!.customer.id}`} className="text-ink hover:text-brand">{c!.customer.displayName}</Link>
            </h1>
            <p className="mt-1 text-sm text-muted">
              {[`CIF ${c!.customer.cif.replace(/^CIF-/, "")}`, c!.customer.language.toUpperCase(), activeLoans === 1 ? A("cl.loans1") : A("cl.loansN", { n: activeLoans })].join(" · ")}
              {!contactAllowed && <span className="ml-2 text-warning">{A("call.contactBlocked")}</span>}
            </p>
          </div>
        ) : (
          <div className="min-w-0">
            <h1 className="page-title">{A("call.noCall")}</h1>
            <p className="mt-1 text-sm text-muted">{A("call.noCallLead")}</p>
          </div>
        )}
        <div className="flex items-center gap-4">
          <span className={`inline-flex items-center gap-2 text-sm ${statusTone}`} data-testid="call-strip">
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
            {status.label}
          </span>
          {status.time !== null && <span className="text-[22px] leading-7 font-medium text-ink tabular-nums" data-testid="call-timer">{fmtDuration(status.time)}</span>}
          {withCustomer && (
            <Popover testId="help" className="btn btn-secondary" label={A("help.title")}>
              <p className="mb-2 font-medium">{A("help.title")}</p>
              <div className="space-y-1.5">
                <div className="kv-row"><span className="kv-label">{A("call.balancesAsOf")}</span><span className={`kv-value ${dataCurrent ? "" : "text-warning"}`}>{fmtDateTime(c!.summary.balancesAsOf, false, locale)}</span></div>
                <div className="kv-row"><span className="kv-label">{T("common.status")}</span><span className={`kv-value ${contactAllowed ? "text-success" : "text-warning"}`}>{contactAllowed ? A("call.contactAllowed") : A("call.contactBlocked")}</span></div>
                <div className="kv-row"><span className="kv-label">{T("agent.facts.contact")}</span><span className="kv-value">{r?.maskedNumber ?? "—"}</span></div>
              </div>
              {inCall && i && (
                <Button size="sm" className="mt-3" disabled={!!p.controlBusy || control?.reconciling} onClick={() => p.onControl("RECONCILE")} data-testid="help-reconcile">
                  {control?.reconciling ? A("rec.checking") : A("rec.check")}
                </Button>
              )}
              <p className="mt-2 text-xs text-muted">{A("rec.lead")}</p>
              <p className="mt-2 text-xs text-muted">{telMode === "MOCK" ? A("tel.mockHint") : telMode === "REAL" ? A("tel.real", { provider: ctx.capabilities.provider ?? "3CX" }) : A("tel.unknown")}</p>
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-2 text-xs text-muted">{A("call.shift")}</p>
                {shift}
              </div>
              {p.showDiagnostics && <p className="mt-2 break-all text-xs text-muted">{i?.correlationId ?? r?.correlationId} · {r?.campaignCode ?? "—"} · {i?.providerInteractionRef ?? "—"} · {control?.providerState ?? "—"}</p>}
            </Popover>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {inCall ? (
          <div className="flex items-center gap-2" role="group" aria-label={A("ctl.end")} data-testid="call-controls">
            {caps.mute && (
              <Button disabled={!live || !!p.controlBusy || pending("MUTE") || pending("UNMUTE")} onClick={() => p.onControl(control?.muted ? "UNMUTE" : "MUTE")} aria-pressed={!!control?.muted} data-testid="ctl-mute">
                {pending("MUTE") || pending("UNMUTE") ? A("ctl.working") : control?.muted ? A("ctl.unmute") : A("ctl.mute")}
              </Button>
            )}
            {caps.hold && (
              <Button disabled={!live || !!p.controlBusy || pending("HOLD") || pending("RESUME")} onClick={() => p.onControl(control?.held ? "RESUME" : "HOLD")} aria-pressed={!!control?.held} data-testid="ctl-hold">
                {pending("HOLD") || pending("RESUME") ? A("ctl.working") : control?.held ? A("ctl.resume") : A("ctl.hold")}
              </Button>
            )}
            {caps.end && (
              <Button variant="danger" className="min-w-36" disabled={!live || !!p.controlBusy || (pending("END") && !endStale)} onClick={() => p.onControl("END")} data-testid="ctl-end">
                {pending("END") && !endStale ? A("ctl.ending") : A("ctl.end")}
              </Button>
            )}
          </div>
        ) : withCustomer ? (
          <span />
        ) : (
          shift
        )}
        {telMode === "MOCK" && (
          <span className="text-[13px] text-muted" title={A("tel.mockHint")} data-testid="telephony-mode">
            {A("tel.mock")}
          </span>
        )}
      </div>

      {(endFailed || endStale) && (
        <div className="callout callout-danger mt-3 flex flex-wrap items-center gap-3" role="alert" data-testid="end-recovery">
          <span className="font-medium">{endFailed ? A("rec.endFailed") : A("rec.endStale")}</span>
          {control?.end?.error && <span className="text-xs">{control.end.error}</span>}
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="danger" disabled={!!p.controlBusy} onClick={() => p.onControl("END")} data-testid="retry-end">
              {A("rec.retryEnd")}
            </Button>
            <Button size="sm" disabled={!!p.controlBusy || control?.reconciling} onClick={() => p.onControl("RECONCILE")} data-testid="reconcile">
              {control?.reconciling ? A("rec.checking") : A("rec.check")}
            </Button>
          </span>
          <span className="w-full text-xs">{A("rec.lead")}</span>
        </div>
      )}
      {!endFailed && !endStale && control?.lastError && inCall && (
        <p className="callout callout-warning mt-3 text-sm" role="status">
          {A("rec.controlFailed", { error: control.lastError })}
        </p>
      )}

      <Dialog open={breakOpen} onClose={() => setBreakOpen(false)} title={T("agent.break")}>
        <Field label={T("agent.breakReason")} htmlFor="break-reason" required>
          <Input id="break-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={async () => {
              setBreakOpen(false);
              await p.onState("BREAK", reason.trim());
              setReason("");
            }}
          >
            {T("agent.confirmBreak")}
          </Button>
          <Button onClick={() => setBreakOpen(false)}>{T("common.cancel")}</Button>
        </div>
      </Dialog>
    </header>
  );
}
