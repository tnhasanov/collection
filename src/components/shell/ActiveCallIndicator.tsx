"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Locale } from "@/i18n/dictionaries";
import { at } from "@/i18n/agentText";

type Active = ({ active: false } | { active: true; stage: "DIALING" | "LIVE" | "ACW" | "WRAP_UP"; reservationId: string | null; interactionId: string | null; customerName: string | null }) & { path?: string };

/** Session key marking a call whose workspace has been shown (by the agent or automatically). */
export const openedKey = (id: string) => `atb:callOpened:${id}`;

/**
 * Return-to-call indicator on every page except the call workspace. It never takes the agent away from what they are
 * doing; the only automatic move is from the dashboard, once per new call, to the call workspace.
 */
export function ActiveCallIndicator({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const [state, setState] = useState<Active>({ active: false });
  const onCallPage = pathname.startsWith("/agent/call");

  useEffect(() => {
    if (onCallPage) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/agent/active", { cache: "no-store" });
        const body = await r.json();
        if (!stopped && body?.ok) setState({ ...(body.data as Active), path: pathname });
      } catch {
        // Offline or signed out: keep the last known state; the next poll retries.
      }
    };
    void check();
    const id = setInterval(check, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [onCallPage, pathname]);

  useEffect(() => {
    // Only a state read on the dashboard itself counts, and only for a call whose workspace was never shown.
    if (!state.active || pathname !== "/agent" || state.path !== "/agent" || !(state.stage === "DIALING" || state.stage === "LIVE")) return;
    const key = openedKey(state.reservationId ?? state.interactionId ?? "");
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    router.push("/agent/call");
  }, [state, pathname, router]);

  if (onCallPage || !state.active) return null;
  const label = state.stage === "ACW" ? at(locale, "dash.acwOpen", { name: state.customerName ?? "—" }) : at(locale, "dash.activeCall", { name: state.customerName ?? "—" });
  return (
    <div className="callout callout-info mb-3 flex flex-wrap items-center gap-3 text-sm" role="status" data-testid="active-call-indicator">
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" aria-hidden="true" />
      <span className="font-medium">{label}</span>
      <Link href="/agent/call" className="ml-auto font-semibold">{at(locale, "nav.returnToCall")} →</Link>
    </div>
  );
}
