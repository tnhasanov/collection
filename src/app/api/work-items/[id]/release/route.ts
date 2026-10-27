import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { releaseWorkItem } from "@/server/modules/work/workItemService";
import { forbidden, notFound } from "@/server/errors";
import { hasPermission } from "@/server/auth/permissions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("queue.read");
    const { id } = await ctx.params;
    const { reason } = await parseBody(req, z.object({ reason: z.string().min(3).max(300) }));
    const wi = await prisma.workItem.findUnique({ where: { id } });
    if (!wi) throw notFound("Work item not found");
    if (wi.claimedByUserId !== user.id && !hasPermission(user.role, "queue.reassign")) throw forbidden("Only the claiming agent or a lead can release this item");
    const r = await releaseWorkItem(prisma, id, `RELEASED:${reason}`, await now(), user.id);
    return ok({ status: r.status });
  } catch (e) {
    return fail(e);
  }
}
