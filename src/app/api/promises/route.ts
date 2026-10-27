import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { createPromise } from "@/server/modules/promises/promiseService";
import { refreshWorkItemEligibility } from "@/server/modules/work/workItemService";

const schema = z.object({ customerId: z.string(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/), deadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), coveredLoanIds: z.array(z.string()).min(1), customerConfirmed: z.boolean(), supersedeReason: z.string().max(300).nullable().optional() });

/** Standalone promise (S07 create drawer). The customer must have confirmed; no silent extension. */
export async function POST(req: Request) {
  try {
    const user = await requireUser("promise.write");
    const input = await parseBody(req, schema);
    await requireCustomerAccess(prisma, user, input.customerId);
    const t = await now();
    const c = await prisma.collectionCase.findFirst({ where: { customerId: input.customerId, status: { in: ["OPEN", "HANDOVER"] } } });
    const lastRpc = await prisma.interaction.findFirst({ where: { customerId: input.customerId, isRpc: true }, orderBy: { startedAt: "desc" } });
    const p = await prisma.$transaction(async (tx) => {
      const promise = await createPromise(tx, { ...input, caseId: c?.id ?? null, interactionId: null, createdByUserId: user.id, ownerUserId: user.id, now: t, lastRpcAt: lastRpc?.connectedAt ?? lastRpc?.startedAt ?? null, supersedeReason: input.supersedeReason ?? null });
      const open = await tx.workItem.findMany({ where: { customerId: input.customerId, type: { in: ["CALL", "CALLBACK"] }, status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } }, select: { id: true } });
      for (const wi of open) await refreshWorkItemEligibility(tx, wi.id, t);
      return promise;
    });
    return ok({ promiseId: p.id, status: p.status, suppressionUntil: p.suppressionUntil });
  } catch (e) {
    return fail(e);
  }
}
