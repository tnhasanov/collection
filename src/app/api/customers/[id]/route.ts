import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { getCustomer360 } from "@/server/modules/customers/customerService";
import { hasPermission } from "@/server/auth/permissions";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("customer.read");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const data = await getCustomer360(prisma, id, { now: await now(), maskContacts: !hasPermission(user.role, "integration.operate") });
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
