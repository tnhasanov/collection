import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("promise.write");
    const { id } = await ctx.params;
    const { reason } = await parseBody(req, z.object({ reason: z.string().min(3).max(300) }));
    const p = await prisma.promise.findUnique({ where: { id } });
    if (!p) throw notFound("Promise not found");
    await requireCustomerAccess(prisma, user, p.customerId);
    if (!["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"].includes(p.status)) throw conflict("Only active promises can be cancelled");
    await prisma.promise.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason, suppressionUntil: null, events: { create: { type: "CANCELLED", fromStatus: p.status, toStatus: "CANCELLED", reason, actorUserId: user.id } } } });
    await appendAudit(prisma, { actorUserId: user.id, action: "promise.cancelled", objectType: "Promise", objectId: id, customerId: p.customerId, reason });
    return ok({ status: "CANCELLED" });
  } catch (e) {
    return fail(e);
  }
}
