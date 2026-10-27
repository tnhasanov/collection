import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { agentDesktopContext } from "@/server/modules/agent/agentDesktopService";
import { workerOnline } from "@/server/modules/dialer/mockEventScheduler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const full = new URL(req.url).searchParams.get("full") !== "0";
    const ctx = await agentDesktopContext(prisma, user, await now(), { full });
    return ok({ ...ctx, workerOnline: await workerOnline() });
  } catch (e) {
    return fail(e);
  }
}
