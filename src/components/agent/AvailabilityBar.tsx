"use client";
import { useEffect, useState } from "react";
import { Badge, Button, Dialog, Field, Input, type Tone } from "@/components/ui";
import { fmtDuration } from "@/lib/format";
import type { AgentContext } from "@/components/agent/types";

const STATE_TONE: Record<string, Tone> = { READY: "success", TALKING: "success", RESERVED: "info", DIALING: "info", ACW: "warning", NOT_READY: "warning", BREAK: "neutral", OFFLINE: "neutral", CONNECTION_PROBLEM: "danger" };
const STATE_LABEL: Record<string, string> = { READY: "Ready", TALKING: "Talking", RESERVED: "Reserved", DIALING: "Dialing", ACW: "After-call work", NOT_READY: "Not ready", BREAK: "Break", OFFLINE: "Offline", CONNECTION_PROBLEM: "Connection problem" };

export function AvailabilityBar({ ctx, serverNow, onAction, busy, user }: { ctx: AgentContext; serverNow: () => Date; onAction: (state: "READY" | "NOT_READY" | "BREAK" | "OFFLINE", reason?: string) => Promise<void>; busy: boolean; user: { displayName: string; roleLabel: string; teamName: string | null; languages: string[] } }) {
  const s = ctx.session;
  const [elapsed, setElapsed] = useState(0);
  const [breakOpen, setBreakOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    const id = setInterval(() => setElapsed(s ? Math.round((serverNow().getTime() - new Date(s.stateSince).getTime()) / 1000) : 0), 1000);
    return () => clearInterval(id);
  }, [s, serverNow]);
  const confirmed = s?.confirmedState ?? "OFFLINE";
  const pendingWrap = !!ctx.interaction && (ctx.interaction.status === "DRAFT" || ctx.interaction.status === "OPEN" || ctx.interaction.wrapUpStatus === "PENDING" || ctx.interaction.wrapUpStatus === "FAILED");
  const busyState = ["RESERVED", "DIALING", "TALKING", "ACW"].includes(confirmed) || !!ctx.reservation;
  const canReady = !!s && s.ctiConnected && !busyState && !pendingWrap && confirmed !== "READY" && !busy;
  return (
    <section className="card card-pad flex flex-wrap items-center gap-3" aria-label="Availability">
      <div className="flex items-center gap-2">
        <Badge tone={STATE_TONE[confirmed] ?? "neutral"} title="Provider-confirmed state">
          {STATE_LABEL[confirmed] ?? confirmed}
        </Badge>
        {s && s.requestedState !== confirmed && !["RESERVED", "DIALING", "TALKING", "ACW"].includes(confirmed) && (
          <Badge tone="info" title="Requested state awaiting provider confirmation">
            → {STATE_LABEL[s.requestedState] ?? s.requestedState} requested
          </Badge>
        )}
        {s && s.pendingBreakAfterWrap && <Badge tone="warning">Break after wrap-up</Badge>}
        <span className="text-xs text-muted tabular-nums" aria-live="off">
          {fmtDuration(elapsed)} in state
        </span>
      </div>
      <div className="text-xs text-muted">
        <span className="font-medium text-ink">{user.displayName}</span> · {user.roleLabel} · {user.teamName ?? "—"} · {user.languages.join("/")} · Ext {s?.extension ?? "—"} ·{" "}
        <span className={s?.ctiConnected ? "text-success" : "text-danger"}>{s?.ctiConnected ? "CTI connected" : `CTI ${s?.ctiStatus?.toLowerCase() ?? "not started"}`}</span> ·{" "}
        <span className={ctx.workerOnline ? "text-success" : "text-danger"}>{ctx.workerOnline ? "Outcome saving online" : "Worker offline — provider commands wait"}</span>
        {s?.stateReason && <span className="ml-2 text-warning">· {s.stateReason}</span>}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted">
          <input type="checkbox" checked={!!s?.autoContinue} disabled={!s || busy} onChange={(e) => void fetch("/api/agent/auto-continue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: e.target.checked }) })} />
          Auto-continue after wrap-up
        </label>
        <Button variant="primary" disabled={!canReady} onClick={() => onAction("READY")} title={pendingWrap ? "Save the outcome and wait for provider wrap-up first" : busyState ? "Busy with a call" : undefined}>
          Go Ready
        </Button>
        <Button variant="secondary" disabled={!s || busy || confirmed === "NOT_READY"} onClick={() => onAction("NOT_READY")}>
          Not ready
        </Button>
        <Button variant="secondary" disabled={!s || busy || confirmed === "BREAK"} onClick={() => setBreakOpen(true)}>
          Break
        </Button>
        <Button variant="ghost" disabled={!s || busy} onClick={() => onAction("OFFLINE", "End of shift")}>
          End shift
        </Button>
      </div>
      <Dialog open={breakOpen} onClose={() => setBreakOpen(false)} title="Request break">
        <Field label="Reason (required by policy)" htmlFor="break-reason" required>
          <Input id="break-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p className="mt-2 text-xs text-muted">A break requested during a call or wrap-up takes effect after the required wrap-up is acknowledged.</p>
        <div className="mt-3 flex gap-2">
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={async () => {
              setBreakOpen(false);
              await onAction("BREAK", reason.trim());
              setReason("");
            }}
          >
            Confirm break
          </Button>
          <Button onClick={() => setBreakOpen(false)}>Cancel</Button>
        </div>
      </Dialog>
    </section>
  );
}
