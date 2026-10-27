import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { notFound } from "@/server/errors";
import { correctOutcome } from "@/server/modules/interactions/outcomeService";
import { BUSINESS_OUTCOMES, IDENTITY_STATUSES, NON_PAYMENT_REASONS } from "@/server/modules/interactions/outcomeSchema";

const schema = z.object({ reason: z.string().min(5).max(400), identityStatus: z.enum(IDENTITY_STATUSES).optional(), businessOutcome: z.enum(BUSINESS_OUTCOMES).optional(), nonPaymentReason: z.enum(NON_PAYMENT_REASONS).nullable().optional(), note: z.string().max(2000).nullable().optional() });

/** Audited outcome correction (interaction.correct): re-evaluates policy effects and reconciles provider callability. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("interaction.correct");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const i = await prisma.interaction.findUnique({ where: { id }, select: { customerId: true } });
  if (!i) throw notFound("Interaction not found");
  await requireCustomerAccess(prisma, user, i.customerId);
  const { reason, ...changes } = body;
  const r = await prisma.$transaction(async (tx) => correctOutcome(tx, { interactionId: id, actorUserId: user.id, reason, changes, now: await now() }), { timeout: 20_000 });
  return ok({ status: r.interaction.status, effects: r.effects });
});
