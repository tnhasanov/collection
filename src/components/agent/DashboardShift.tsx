"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Toast } from "@/components/ui";
import { t, type Locale } from "@/i18n/dictionaries";
import { at, errorText } from "@/i18n/agentText";
import { api } from "@/components/agent/useAgentStream";

const DOT: Record<string, string> = { READY: "bg-success", TALKING: "bg-success", ACW: "bg-warning", NOT_READY: "bg-warning", BREAK: "bg-muted", OFFLINE: "bg-muted", CONNECTION_PROBLEM: "bg-danger" };

/**
 * Shift state and the primary action on the dashboard. "Go Ready" connects to the dialer if needed, waits for the
 * provider to confirm the phone connection, requests Ready and opens the call workspace, where the next customer is
 * assigned. During a call the action is the way back to it.
 */
export function DashboardShift({ locale, state, hasSession, inCall }: { locale: Locale; state: string; hasSession: boolean; inCall: boolean }) {
  const A = (k: string) => at(locale, k);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function goReady() {
    setBusy(true);
    setError(null);
    try {
      if (!hasSession) {
        const c = await api("/api/agent/session");
        if (!c.ok) throw c.error;
      }
      // The provider confirms the phone connection asynchronously; Ready is requested once it is confirmed.
      for (let i = 0; i < 20; i++) {
        const ctx = await fetch("/api/agent/context?full=0", { cache: "no-store" }).then((r) => r.json());
        if (ctx?.data?.session?.ctiConnected) break;
        await new Promise((r) => setTimeout(r, 750));
      }
      const r = await api("/api/agent/state", { state: "READY", reason: null });
      if (!r.ok) throw r.error;
      router.push("/agent/call");
    } catch (e) {
      setError(errorText(locale, e as { code?: string; message?: string }));
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4" data-testid="dash-shift">
      <Toast message={error} tone="danger" />
      <span className="inline-flex items-center gap-2 text-sm text-muted" data-testid="dash-state">
        <span className={`h-2 w-2 rounded-full ${DOT[state] ?? "bg-muted"}`} aria-hidden="true" />
        {t(locale, `agent.states.${state}`)}
      </span>
      {inCall ? (
        <Link href="/agent/call" className="btn btn-primary !text-white" data-testid="dash-open-call">{A("dash.backToCall")}</Link>
      ) : state === "READY" ? (
        <Link href="/agent/call" className="btn btn-primary !text-white" data-testid="dash-open-call">{A("dash.workspace")}</Link>
      ) : (
        <button type="button" className="btn btn-primary min-w-32" disabled={busy} onClick={goReady} data-testid="dash-go-ready">
          {busy ? A("dash.connecting") : A("dash.goReady")}
        </button>
      )}
    </div>
  );
}
