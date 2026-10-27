import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";

const schema = z.object({ ownerUserId: z.string().nullable(), reason: z.string().min(3).max(300) });

/** Reassignment preserves the audit trail; active calls cannot be reassigned. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("queue.reassign");
    const { id } = await ctx.params;
    const { ownerUserId, reason } = await parseBody(req, schema);
    const wi = await prisma.workItem.findUnique({ where: { id } });
    if (!wi) throw notFound("Work item not found");
    if (wi.status === "IN_PROGRESS") throw conflict("Cannot reassign an item with an active interaction");
    if (ownerUserId) {
      const target = await prisma.user.findUnique({ where: { id: ownerUserId }, include: { agentProfile: true } });
      if (!target || !target.isActive) throw notFound("Target user not found");
      if (wi.requiredSkill === "SENIOR" && target.agentProfile?.seniority !== "SENIOR") throw conflict("Senior-only item cannot be assigned to a regular agent");
    }
    const updated = await prisma.workItem.update({ where: { id }, data: { ownerUserId, claimedByUserId: null, claimedAt: null, leaseExpiresAt: null, status: wi.status === "CLAIMED" ? "QUEUED" : wi.status, version: { increment: 1 } } });
    await appendAudit(prisma, { actorUserId: user.id, action: "work.reassigned", objectType: "WorkItem", objectId: id, customerId: wi.customerId, caseId: wi.caseId, reason, changes: { from: wi.ownerUserId, to: ownerUserId } });
    return ok({ ownerUserId: updated.ownerUserId, status: updated.status });
  } catch (e) {
    return fail(e);
  }
}
