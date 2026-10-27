import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseQuery } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";

/** Re-check eligibility immediately before any outreach (also used by the S04 action panel). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("customer.read");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const { channel, contactPointId } = parseQuery(req, z.object({ channel: z.enum(["VOICE", "SMS"]).default("VOICE"), contactPointId: z.string().optional() }));
    const r = await evaluateCustomerEligibility(prisma, id, { channel, now: await now(), contactPointId: contactPointId ?? null });
    return ok({ eligible: r.decision.eligible, reasonCodes: r.decision.reasonCodes, reasons: r.decision.reasonCodes.map((c) => REASON_LABELS[c] ?? c), nextAllowedAt: r.decision.nextAllowedAt, policyVersion: r.decision.policyVersion, checks: r.decision.checks, contactPointId: r.contactPointId });
  } catch (e) {
    return fail(e);
  }
}
