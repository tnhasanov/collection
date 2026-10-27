import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { createCallbackWorkItem, refreshWorkItemEligibility } from "@/server/modules/work/workItemService";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { nextPermittedTime } from "@/server/modules/contactPolicy/evaluator";
import { notFound, badRequest } from "@/server/errors";

const schema = z.object({ customerId: z.string(), dueAt: z.string().datetime({ offset: true }), customerRequested: z.boolean(), ownerMode: z.enum(["ME", "POOL"]), reason: z.string().min(3).max(300) });

export async function POST(req: Request) {
  try {
    const user = await requireUser("callback.write");
    const input = await parseBody(req, schema);
    await requireCustomerAccess(prisma, user, input.customerId);
    const t = await now();
    const due = new Date(input.dueAt);
    if (due.getTime() < t.getTime()) throw badRequest("Callback time must be in the future");
    const policy = await getContactPolicy(prisma);
    const permitted = nextPermittedTime(due, policy);
    const c = await prisma.collectionCase.findFirst({ where: { customerId: input.customerId, status: { in: ["OPEN", "HANDOVER"] } } });
    if (!c) throw notFound("No open collection case");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: input.customerId } });
    const wi = await createCallbackWorkItem(prisma, { customerId: input.customerId, caseId: c.id, dueAt: permitted, ownerUserId: input.ownerMode === "ME" ? user.id : null, reason: `${input.customerRequested ? "CUSTOMER_REQUESTED" : "AGENT_PROPOSED"}: ${input.reason}`, language: customer.language, requiredSkill: null, now: t, actorUserId: user.id, campaignCode: "SOFT_COLLECTIONS_VOICE" });
    await refreshWorkItemEligibility(prisma, wi.id, t);
    return ok({ workItemId: wi.id, dueAt: permitted, adjusted: permitted.getTime() !== due.getTime() });
  } catch (e) {
    return fail(e);
  }
}
