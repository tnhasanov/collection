import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { ensureTaskWorkItem } from "@/server/modules/work/workItemService";
import { appendAudit } from "@/server/modules/audit/audit";
import { notFound } from "@/server/errors";

const schema = z.object({ reason: z.string().min(3).max(500) });

/** Request escalation: creates an owned manual-review task for the team lead (no restriction override). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const { reason } = await parseBody(req, schema);
    const c = await prisma.collectionCase.findFirst({ where: { customerId: id, status: { in: ["OPEN", "HANDOVER"] } } });
    if (!c) throw notFound("No open collection case");
    const lead = await prisma.user.findFirst({ where: { role: "TEAM_LEAD", isActive: true } });
    const wi = await ensureTaskWorkItem(prisma, { customerId: id, caseId: c.id, type: "MANUAL_REVIEW", dueAt: new Date((await now()).getTime() + 86_400_000), ownerUserId: lead?.id ?? null, reason: `ESCALATION by ${user.displayName}: ${reason}`, requiredSkill: "SENIOR" });
    await appendAudit(prisma, { actorUserId: user.id, action: "case.escalation_requested", objectType: "WorkItem", objectId: wi.id, customerId: id, caseId: c.id, reason });
    return ok({ workItemId: wi.id });
  } catch (e) {
    return fail(e);
  }
}
