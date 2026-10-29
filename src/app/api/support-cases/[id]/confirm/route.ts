import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { cancelReminders } from "@/server/modules/promises/reminderService";
import { invalidateObsoleteWork, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { conflict, notFound } from "@/server/errors";

const schema = z.object({ decision: z.enum(["CONFIRM", "REJECT"]), note: z.string().min(3).max(600) });

/**
 * Verification of a reported special case (deceased / legal). CONFIRM moves the customer to confirmed special
 * handling (promises cancelled, routine work withdrawn, reminders stopped); REJECT returns the customer to the
 * normal process and re-evaluates open work. Both are audited with the verifier and the evidence note.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("special-case.confirm");
    const { id } = await ctx.params;
    const { decision, note } = await parseBody(req, schema);
    const sc = await prisma.supportCase.findUnique({ where: { id } });
    if (!sc) throw notFound("Support case not found");
    if (sc.type !== "DECEASED_LEGAL" && sc.type !== "SPECIAL_HANDLING") throw conflict("Only special cases (deceased / legal / special handling) are confirmed here");
    if (sc.confirmedAt || sc.status === "REJECTED" || sc.status === "RESOLVED") throw conflict(`Report already ${sc.confirmedAt ? "confirmed" : sc.status.toLowerCase()}`);
    await requireCustomerAccess(prisma, user, sc.customerId);
    const t = await now();
    const effects: Record<string, unknown> = {};
    if (decision === "CONFIRM") {
      await prisma.supportCase.update({ where: { id }, data: { confirmedAt: t, confirmedBy: user.id, status: "UNDER_REVIEW", resolution: `Confirmed: ${note}` } });
      await prisma.customer.update({ where: { id: sc.customerId }, data: { status: sc.type === "DECEASED_LEGAL" ? "DECEASED_NOTIFIED" : "LEGAL", specialHandling: true, specialHandlingReason: sc.type === "DECEASED_LEGAL" ? `Deceased - confirmed ${t.toISOString().slice(0, 10)}` : `Special handling - confirmed ${t.toISOString().slice(0, 10)}` } });
      const promises = await prisma.promise.findMany({ where: { customerId: sc.customerId, status: { in: ["ACTIVE", "PARTIALLY_PAID", "PENDING_RECONCILIATION"] } } });
      for (const p of promises) {
        await prisma.promise.update({ where: { id: p.id }, data: { status: "CANCELLED", cancelReason: `SPECIAL_CASE_CONFIRMED: ${sc.type}`, suppressionUntil: null, version: { increment: 1 }, events: { create: { type: "CANCELLED", fromStatus: p.status, toStatus: "CANCELLED", reason: `Special case confirmed (${sc.type})`, actorUserId: user.id } } } });
        await cancelReminders(prisma, p.id, `Special case confirmed (${sc.type})`, t);
      }
      effects.promisesCancelled = promises.length;
      effects.work = await invalidateObsoleteWork(prisma, sc.customerId, `SPECIAL_CASE_CONFIRMED:${sc.type}`, t);
      await prisma.exceptionCase.updateMany({ where: { dedupKey: `DECEASED_VERIFICATION:${sc.customerId}`, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, data: { status: "RESOLVED", resolvedAt: t, resolvedBy: user.id, resolution: `Confirmed by ${user.username}: ${note}` } });
    } else {
      await prisma.supportCase.update({ where: { id }, data: { status: "REJECTED", resolvedAt: t, resolution: `Not confirmed: ${note}`, restrictsCalls: false } });
      await prisma.customer.update({ where: { id: sc.customerId }, data: { status: "ACTIVE" } });
      await prisma.exceptionCase.updateMany({ where: { dedupKey: `DECEASED_VERIFICATION:${sc.customerId}`, status: { in: ["OPEN", "ASSIGNED", "REOPENED"] } }, data: { status: "RESOLVED", resolvedAt: t, resolvedBy: user.id, resolution: `Report rejected by ${user.username}: ${note}` } });
      await prisma.workItem.updateMany({ where: { customerId: sc.customerId, type: "HANDOVER", status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED", "CLAIMED"] }, reason: { startsWith: "Vəfat barədə məlumat" } }, data: { status: "CANCELLED", cancelReason: `Report not confirmed: ${note}`, completedAt: t } });
      const open = await prisma.workItem.findMany({ where: { customerId: sc.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
      for (const wi of open) await refreshWorkItemEligibility(prisma, wi.id, t);
      effects.workReevaluated = open.length;
    }
    await appendAudit(prisma, { actorUserId: user.id, action: decision === "CONFIRM" ? "special_case.confirmed" : "special_case.rejected", objectType: "SupportCase", objectId: id, customerId: sc.customerId, caseId: sc.caseId, reason: note, changes: { type: sc.type, reporterRelation: sc.reporterRelation, reportSource: sc.reportSource, effects } });
    return ok({ decision, effects });
  } catch (e) {
    return fail(e);
  }
}
