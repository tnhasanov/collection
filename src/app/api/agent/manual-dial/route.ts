import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { requireCustomerAccess } from "@/server/auth/access";
import { getActiveSession } from "@/server/modules/dialer/agentSessionService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, forbidden } from "@/server/errors";

const schema = z.object({ customerId: z.string(), reason: z.string().min(3).max(300) });

/**
 * Controlled manual selection: the request is validated here and the reservation itself is created by the worker's
 * routing loop (same policy, same provider authorization). The customer is marked as the agent's next eligible item.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { customerId, reason } = await parseBody(req, schema);
    const profile = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
    if (!profile?.manualDialAllowed) throw forbidden("Manual dialing is a controlled privilege for this agent");
    await requireCustomerAccess(prisma, user, customerId);
    const session = await getActiveSession(prisma, user.id);
    if (!session || session.confirmedState !== "READY") throw conflict("Agent must be confirmed Ready", { code: "NOT_READY" });
    const t = await now();
    const wi = await prisma.workItem.findFirst({ where: { customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } });
    if (!wi) throw conflict("No open call work item for this customer", { code: "NO_WORK_ITEM" });
    const { decision } = await evaluateCustomerEligibility(prisma, customerId, { channel: "VOICE", now: t, dueCallback: wi.type === "CALLBACK" ? { dueAt: wi.dueAt ?? t, customerRequested: wi.reason?.startsWith("CUSTOMER_REQUESTED") ?? false } : null });
    if (!decision.eligible) throw conflict("Customer is not eligible right now", { code: "NOT_ELIGIBLE", reasonCodes: decision.reasonCodes, nextAllowedAt: decision.nextAllowedAt });
    await prisma.workItem.update({ where: { id: wi.id }, data: { status: "ELIGIBLE", ownerUserId: user.id, nextEligibleAt: t, rank: 0, reason: `MANUAL:${reason}` } });
    await appendAudit(prisma, { actorUserId: user.id, action: "work.manual_dial_requested", objectType: "WorkItem", objectId: wi.id, customerId, reason });
    return ok({ workItemId: wi.id, note: "Customer queued as your next automatic allocation; the provider authorizes the dial" });
  } catch (e) {
    return fail(e);
  }
}
