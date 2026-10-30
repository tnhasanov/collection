import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { getActiveSession } from "@/server/modules/dialer/agentSessionService";
import { providerCapabilities } from "@/server/modules/agent/agentDesktopService";
import { requestCallControl } from "@/server/modules/dialer/callControlService";
import { conflict } from "@/server/errors";

const schema = z.object({ interactionId: z.string(), action: z.enum(["MUTE", "UNMUTE", "HOLD", "RESUME", "TRANSFER", "END", "RECONCILE"]) });

/**
 * Call controls are requests to the provider through the outbox. Each attempt has its own key; a second click while
 * an attempt is still open returns that attempt (no duplicate command). RECONCILE asks the worker to compare the call
 * with the provider's view now; it is the recovery action for an unresolved command and never ends a call itself.
 * Only capabilities the adapter reports are accepted.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { interactionId, action } = await parseBody(req, schema);
    if (action !== "RECONCILE") {
      const caps = await providerCapabilities(prisma);
      const supported = action === "END" ? caps.end : action === "TRANSFER" ? caps.transfer : action === "MUTE" || action === "UNMUTE" ? caps.mute : caps.hold;
      if (!supported) throw conflict(`${action} is not supported by the connected provider${caps.provider ? ` (${caps.provider})` : ""}`, { code: "UNSUPPORTED" });
    }
    const session = await getActiveSession(prisma, user.id);
    const r = await requestCallControl(prisma, { interactionId, userId: user.id, action, agentRef: session?.providerAgentRef ?? null, now: await now() });
    return ok({ requested: action, status: r.status, command: r.command });
  } catch (e) {
    return fail(e);
  }
}
