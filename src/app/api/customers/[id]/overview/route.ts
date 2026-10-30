import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";
import { customerOverview } from "@/server/modules/customers/customerListService";

export const dynamic = "force-dynamic";

/**
 * Detail panel of the customer lists: summary, individual loans, open promises with their loans, last contact and the
 * open work in workflow order. Read-only — it never claims work, reserves the customer or starts a call. Access is
 * checked against the caller's customer scope and the view is audited like the customer page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("customer.read");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const data = await customerOverview(prisma, id, await now());
    if (!data) throw notFound("Customer not found");
    await appendAudit(prisma, { actorUserId: user.id, action: "customer.viewed", objectType: "Customer", objectId: id, customerId: id, reason: "List detail panel" });
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
