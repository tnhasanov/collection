import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { appendAudit } from "@/server/modules/audit/audit";
import { notFound, unprocessable } from "@/server/errors";
import { simulateStrategy, validateStrategyConfig } from "@/server/modules/strategy/strategyService";

/** Dry simulation: counts by treatment, unscored, blocked contacts, workload, costs and differences versus the active policy. */
export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("strategy.read");
  const { id } = await ctx.params;
  const sv = await prisma.strategyVersion.findUnique({ where: { id } });
  if (!sv) throw notFound("Strategy version not found");
  const validation = validateStrategyConfig(sv.configJson);
  if (!validation.ok || !validation.config) throw unprocessable("Fix validation errors before simulating", validation.issues);
  const t = await now();
  const result = await simulateStrategy(prisma, validation.config, t);
  const nextStatus = sv.status === "DRAFT" ? "TESTED" : sv.status;
  await prisma.strategyVersion.update({ where: { id }, data: { simulationJson: result as never, simulatedAt: t, status: nextStatus } });
  await appendAudit(prisma, { actorUserId: user.id, action: "strategy.simulated", objectType: "StrategyVersion", objectId: id, changes: { population: result.population, callItems: result.workload.callItems, changed: result.changedCustomers.length, status: nextStatus } });
  return ok({ result, status: nextStatus });
});
