"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentContext } from "@/components/agent/types";

/**
 * Subscribes to the per-agent SSE stream with polling fallback; keeps a server-clock offset (all timers are
 * anchored on the server's domain clock, never on the browser clock) and sends browser heartbeats.
 * A `session` event (revoked/expired) or a 401 from the polling fallback returns the user to sign-in.
 */
/** Hard navigation (full reload) so revoked sessions drop every piece of client state before sign-in. */
export function redirectToLogin(reason = "session") {
  if (typeof window === "undefined") return;
  const target = new URL("/login", window.location.origin);
  target.searchParams.set("reason", reason);
  window.location.replace(target.toString());
}

export function useAgentStream(initial: AgentContext | null) {
  const [ctx, setCtx] = useState<AgentContext | null>(initial);
  const [connected, setConnected] = useState(false);
  const offsetRef = useRef(0);
  const fullRef = useRef<{ metrics?: AgentContext["metrics"]; panels?: AgentContext["panels"] }>({ metrics: initial?.metrics, panels: initial?.panels });

  const toLogin = () => redirectToLogin();

  const refreshFull = useCallback(async () => {
    const res = await fetch("/api/agent/context?full=1", { cache: "no-store" });
    if (res.status === 401) return toLogin();
    const json = await res.json();
    if (json.ok) {
      fullRef.current = { metrics: json.data.metrics, panels: json.data.panels };
      setCtx(json.data);
      offsetRef.current = new Date(json.data.serverNow).getTime() - Date.now();
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    const apply = (data: AgentContext) => {
      offsetRef.current = new Date(data.serverNow).getTime() - Date.now();
      setCtx({ ...data, metrics: data.metrics ?? fullRef.current.metrics, panels: data.panels ?? fullRef.current.panels });
    };
    const startPolling = () => {
      if (poll || stopped) return;
      poll = setInterval(async () => {
        try {
          const res = await fetch("/api/agent/context?full=0", { cache: "no-store" });
          if (res.status === 401) return toLogin();
          const json = await res.json();
          if (json.ok) apply(json.data);
        } catch {
          /* retry next tick */
        }
      }, 2500);
    };
    try {
      es = new EventSource("/api/agent/stream");
      es.addEventListener("context", (e) => {
        setConnected(true);
        apply(JSON.parse((e as MessageEvent).data));
      });
      es.addEventListener("ping", (e) => {
        setConnected(true);
        const d = JSON.parse((e as MessageEvent).data);
        offsetRef.current = new Date(d.serverNow).getTime() - Date.now();
      });
      es.addEventListener("session", () => {
        stopped = true;
        es?.close();
        toLogin();
      });
      es.onerror = () => {
        setConnected(false);
        startPolling();
      };
    } catch {
      startPolling();
    }
    const hb = setInterval(() => void fetch("/api/agent/heartbeat", { method: "POST" }).then((r) => (r.status === 401 ? toLogin() : undefined)).catch(() => undefined), 10_000);
    void fetch("/api/agent/heartbeat", { method: "POST" }).catch(() => undefined);
    const full = setInterval(() => void refreshFull(), 30_000);
    return () => {
      stopped = true;
      es?.close();
      if (poll) clearInterval(poll);
      clearInterval(hb);
      clearInterval(full);
    };
  }, [refreshFull]);

  const serverNow = useCallback(() => new Date(Date.now() + offsetRef.current), []);
  return { ctx, setCtx, connected, serverNow, refreshFull };
}

export async function api<T = unknown>(path: string, body?: unknown, method = "POST"): Promise<{ ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } }> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) redirectToLogin();
  try {
    return await res.json();
  } catch {
    return { ok: false, error: { code: "NETWORK", message: `Request failed (${res.status})` } };
  }
}
