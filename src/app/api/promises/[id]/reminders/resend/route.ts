import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { notFound } from "@/server/errors";
import { resendReminder } from "@/server/modules/promises/reminderService";

/** Manual reminder resend (lead/head). The job runs the same pre-send rechecks as scheduled reminders and is audited. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("reminder.resend");
    const { id } = await ctx.params;
    const p = await prisma.promise.findUnique({ where: { id }, select: { customerId: true } });
    if (!p) throw notFound("Promise not found");
    await requireCustomerAccess(prisma, user, p.customerId);
    return ok(await resendReminder(prisma, { promiseId: id, actorUserId: user.id, now: await now() }));
  } catch (e) {
    return fail(e);
  }
}
