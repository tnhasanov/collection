import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { getActiveSession, heartbeat } from "@/server/modules/dialer/agentSessionService";

export async function POST() {
  try {
    const user = await requireUser("agent.desktop");
    const session = await getActiveSession(prisma, user.id);
    if (session) await heartbeat(prisma, session.id, await now());
    return ok({ alive: !!session });
  } catch (e) {
    return fail(e);
  }
}
