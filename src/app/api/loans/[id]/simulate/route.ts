import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { buildAnnuitySchedule, serializeSchedule, AnnuityValidationError } from "@/server/modules/finance/annuity";
import { badRequest, notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";

const schema = z.object({ principal: z.string().regex(/^\d+(\.\d{1,2})?$/), nominalAnnualRatePct: z.string().regex(/^\d+(\.\d{1,4})?$/), months: z.number().int().min(1).max(600), firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentDay: z.number().int().min(1).max(31).optional() });

/** Simulation never overwrites the imported core schedule; results are labelled as local calculation. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("customer.read");
    const { id } = await ctx.params;
    const loan = await prisma.loan.findUnique({ where: { id }, select: { customerId: true } });
    if (!loan) throw notFound("Loan not found");
    await requireCustomerAccess(prisma, user, loan.customerId);
    const input = await parseBody(req, schema);
    try {
      const s = buildAnnuitySchedule({ principal: input.principal, nominalAnnualRate: (Number(input.nominalAnnualRatePct) / 100).toFixed(6), months: input.months, firstDueDate: input.firstDueDate, paymentDay: input.paymentDay });
      await appendAudit(prisma, { actorUserId: user.id, action: "loan.simulation.run", objectType: "Loan", objectId: id, customerId: loan.customerId, changes: input });
      return ok(serializeSchedule(s));
    } catch (e) {
      if (e instanceof AnnuityValidationError) throw badRequest(e.message);
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
