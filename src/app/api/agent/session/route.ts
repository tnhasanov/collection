import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { startAgentSession } from "@/server/modules/dialer/agentSessionService";

export async function POST() {
  try {
    const user = await requireUser("agent.desktop");
    const profile = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
    const session = await startAgentSession(prisma, { userId: user.id, providerAgentRef: profile?.providerAgentRef ?? null, extension: profile?.extension ?? null, campaignCodes: profile?.campaignCodes ?? [], autoContinueAllowed: profile?.autoContinueAllowed ?? true, now: await now() });
    return ok({ sessionId: session.id });
  } catch (e) {
    return fail(e);
  }
}
