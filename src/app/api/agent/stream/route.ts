import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { agentDesktopContext } from "@/server/modules/agent/agentDesktopService";
import { workerOnline } from "@/server/modules/dialer/mockEventScheduler";

export const dynamic = "force-dynamic";

/** Per-agent SSE stream: pushes this agent's own authorized context whenever its state signature changes. */
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser("agent.desktop");
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      let lastSig = "";
      let lastFull = 0;
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = async () => {
        if (closed) return;
        try {
          const t = await now();
          const ctx = await agentDesktopContext(prisma, user!, t, { full: false });
          const sig = JSON.stringify([ctx.session?.confirmedState, ctx.session?.requestedState, ctx.session?.ctiConnected, ctx.session?.stateReason, ctx.reservation?.id, ctx.reservation?.status, ctx.reservation?.attempt?.technicalResult, ctx.interaction?.id, ctx.interaction?.status, ctx.interaction?.wrapUpStatus, ctx.interaction?.endedAt, ctx.notifications.map((n) => n.id), ctx.customer?.summary.overdueDueNow, ctx.customer?.summary.balancesAsOf]);
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
      const interval = setInterval(() => void tick(), 1000);
      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
