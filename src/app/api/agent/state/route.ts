import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { getActiveSession, requestAgentState } from "@/server/modules/dialer/agentSessionService";
import { conflict } from "@/server/errors";

const schema = z.object({ state: z.enum(["READY", "NOT_READY", "BREAK", "OFFLINE"]), reason: z.string().max(200).optional().nullable() });

export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { state, reason } = await parseBody(req, schema);
    const session = await getActiveSession(prisma, user.id);
    if (!session) throw conflict("No active agent session; sign in to the dialer first", { code: "NO_SESSION" });
    if (state === "BREAK" && !reason) throw conflict("A reason is required for Break", { code: "REASON_REQUIRED" });
    const r = await requestAgentState(prisma, { sessionId: session.id, state, reason: reason ?? null, now: await now(), actorUserId: user.id });
    return ok({ requestedState: r.session.requestedState, confirmedState: r.session.confirmedState, deferred: r.deferred });
  } catch (e) {
    return fail(e);
  }
}
