import { prisma } from "@/server/db";
import { loadSessionUser, requireUser, SESSION_COOKIE } from "@/server/auth/session";
import { now } from "@/server/clock";
import { agentDesktopContext } from "@/server/modules/agent/agentDesktopService";
import { workerOnline } from "@/server/modules/dialer/mockEventScheduler";

export const dynamic = "force-dynamic";

function sessionToken(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Per-agent SSE stream: pushes this agent's own authorized context whenever its state signature changes.
 * The session is re-validated on every tick: a revoked or expired session closes the long-lived stream at once
 * (the browser receives a `session` event and returns to sign-in) instead of living on until the tab is closed.
 */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser("agent.desktop");
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const token = sessionToken(req);
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      let lastSig = "";
      let lastFull = 0;
      let interval: ReturnType<typeof setInterval> | null = null;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const tick = async () => {
        if (closed) return;
        try {
          const live = await loadSessionUser(token);
          if (!live || live.id !== user!.id) {
            send("session", { revoked: true, reason: "Session ended or revoked" });
            close();
            return;
          }
          const t = await now();
          const ctx = await agentDesktopContext(prisma, live, t, { full: false });
          const sig = JSON.stringify([ctx.session?.confirmedState, ctx.session?.requestedState, ctx.session?.ctiConnected, ctx.session?.stateReason, ctx.reservation?.id, ctx.reservation?.status, ctx.reservation?.attempt?.technicalResult, ctx.interaction?.id, ctx.interaction?.status, ctx.interaction?.wrapUpStatus, ctx.interaction?.endedAt, ctx.interaction?.controlState, ctx.notifications.map((n) => n.id), ctx.customer?.summary.overdueDueNow, ctx.customer?.summary.balancesAsOf]);
          if (sig !== lastSig || Date.now() - lastFull > 15_000) {
            lastSig = sig;
            lastFull = Date.now();
            send("context", { ...ctx, workerOnline: await workerOnline() });
          } else {
            send("ping", { serverNow: t });
          }
        } catch (e) {
          send("error", { message: String(e) });
        }
      };
      await tick();
      interval = setInterval(() => void tick(), 1000);
      req.signal.addEventListener("abort", close);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
