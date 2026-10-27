import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { getActiveSession, setAutoContinue } from "@/server/modules/dialer/agentSessionService";
import { conflict, forbidden } from "@/server/errors";

export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { value } = await parseBody(req, z.object({ value: z.boolean() }));
    const profile = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
    if (!profile?.autoContinueAllowed) throw forbidden("Automatic continuation is not permitted for this agent");
    const session = await getActiveSession(prisma, user.id);
    if (!session) throw conflict("No active agent session");
    const s = await setAutoContinue(prisma, session.id, value, user.id);
    return ok({ autoContinue: s.autoContinue });
  } catch (e) {
    return fail(e);
  }
}
