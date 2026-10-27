import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { refreshMockSources } from "@/server/modules/jobs/maintenance";
import { refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { notFound } from "@/server/errors";

const schema = z.object({ action: z.enum(["ASSIGN_ME", "REQUEST_REFRESH", "RESOLVE", "REOPEN"]), reason: z.string().max(500).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("exception.manage");
    const { id } = await ctx.params;
    const { action, reason } = await parseBody(req, schema);
    const e = await prisma.exceptionCase.findUnique({ where: { id } });
    if (!e) throw notFound("Exception not found");
    const t = await now();
    switch (action) {
      case "ASSIGN_ME": await prisma.exceptionCase.update({ where: { id }, data: { ownerUserId: user.id, status: "ASSIGNED" } }); break;
      case "REQUEST_REFRESH": {
        if (e.type === "STALE_BALANCES") {
          await prisma.exceptionCase.update({ where: { id }, data: { status: "RESOLVED", resolution: `Source refresh requested and completed (mock): ${reason ?? ""}`, resolvedBy: user.id, resolvedAt: t } });
          await refreshMockSources(prisma, t);
          const items = await prisma.workItem.findMany({ where: { customerId: e.customerId ?? undefined, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "DEFERRED"] } }, select: { id: true } });
          for (const wi of items) await refreshWorkItemEligibility(prisma, wi.id, t);
        } else {
          await prisma.exceptionCase.update({ where: { id }, data: { status: "ASSIGNED", ownerUserId: e.ownerUserId ?? user.id, evidence: { ...((e.evidence as object) ?? {}), refreshRequestedAt: t, by: user.username } as never } });
          await refreshMockSources(prisma, t);
        }
        break;
      }
      case "RESOLVE": if (!reason) throw notFound("A resolution reason is required"); await prisma.exceptionCase.update({ where: { id }, data: { status: "RESOLVED", resolution: reason, resolvedBy: user.id, resolvedAt: t } }); break;
      case "REOPEN": await prisma.exceptionCase.update({ where: { id }, data: { status: "REOPENED", resolution: null, resolvedAt: null, lastSeenAt: t } }); break;
    }
    await appendAudit(prisma, { actorUserId: user.id, action: `exception.${action.toLowerCase()}`, objectType: "ExceptionCase", objectId: id, customerId: e.customerId, reason: reason ?? null });
    return ok(await prisma.exceptionCase.findUnique({ where: { id } }));
  } catch (e) {
    return fail(e);
  }
}
