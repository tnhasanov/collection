import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { getLoanDetail } from "@/server/modules/finance/loanDetailService";
import { notFound } from "@/server/errors";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("customer.read");
    const { id } = await ctx.params;
    const loan = await prisma.loan.findUnique({ where: { id }, select: { customerId: true } });
    if (!loan) throw notFound("Loan not found");
    await requireCustomerAccess(prisma, user, loan.customerId);
    return ok(await getLoanDetail(prisma, id));
  } catch (e) {
    return fail(e);
  }
}
