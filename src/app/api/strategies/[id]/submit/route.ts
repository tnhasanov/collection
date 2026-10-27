import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { validateStrategyConfig } from "@/server/modules/strategy/strategyService";

const schema = z.object({ rationale: z.string().min(5).max(600), proposedEffectiveAt: z.string().datetime({ offset: true }).optional() });

/** Submit a TESTED version for independent approval (S11). The maker can never approve their own request. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("approval.request");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const sv = await prisma.strategyVersion.findUnique({ where: { id } });
  if (!sv) throw notFound("Strategy version not found");
  if (sv.status !== "TESTED") throw unprocessable("Run a dry simulation first: only TESTED versions can be submitted");
  const validation = validateStrategyConfig(sv.configJson);
  if (!validation.ok) throw unprocessable("Validation errors must be resolved before submission", validation.issues);
  const pending = await prisma.approvalRequest.findFirst({ where: { objectType: "StrategyVersion", objectId: id, status: { in: ["PENDING", "INFO_REQUESTED"] } } });
  if (pending) throw conflict(`Approval request ${pending.id} is already open for this version`);
  const active = await prisma.strategyVersion.findFirst({ where: { code: sv.code, status: "ACTIVE" } });
  const ar = await prisma.approvalRequest.create({
    data: {
      type: "STRATEGY_ACTIVATION",
      makerUserId: user.id,
      objectType: "StrategyVersion",
      objectId: id,
      title: `Activate strategy ${sv.code} ${sv.version}`,
      rationale: body.rationale,
      beforeJson: (active ? { id: active.id, version: active.version, config: active.configJson } : null) as never,
      afterJson: { id: sv.id, version: sv.version, config: sv.configJson } as never,
      impactJson: (sv.simulationJson ?? null) as never,
      validationJson: validation.issues as never,
      proposedEffectiveAt: body.proposedEffectiveAt ? new Date(body.proposedEffectiveAt) : null,
      rollbackTargetId: active?.id ?? null,
    },
  });
  await appendAudit(prisma, { actorUserId: user.id, action: "approval.requested", objectType: "ApprovalRequest", objectId: ar.id, reason: body.rationale, changes: { type: "STRATEGY_ACTIVATION", strategyVersionId: id } });
  return ok({ approvalId: ar.id });
});
