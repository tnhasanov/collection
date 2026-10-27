import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { badRequest, conflict, notFound } from "@/server/errors";
import { validateStrategyConfig } from "@/server/modules/strategy/strategyService";
import { Prisma } from "@/generated/prisma/client";

const schema = z.object({ config: z.unknown(), notes: z.string().max(400).optional() });

/** Update a DRAFT strategy's decision tables. Validation errors are returned as data; nothing is published here. */
export const PUT = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("strategy.draft");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const sv = await prisma.strategyVersion.findUnique({ where: { id } });
  if (!sv) throw notFound("Strategy version not found");
  if (sv.status !== "DRAFT" && sv.status !== "TESTED") throw conflict(`Only DRAFT/TESTED versions are editable (status ${sv.status}); clone it into a new draft`);
  const validation = validateStrategyConfig(body.config);
  if (!validation.config) throw badRequest("Configuration does not match the strategy schema", validation.issues);
  const updated = await prisma.strategyVersion.update({ where: { id }, data: { configJson: validation.config as never, notes: body.notes ?? sv.notes, status: "DRAFT", simulationJson: Prisma.DbNull, simulatedAt: null } });
  await appendAudit(prisma, { actorUserId: user.id, action: "strategy.draft.updated", objectType: "StrategyVersion", objectId: id, changes: { before: sv.configJson, after: validation.config, issues: validation.issues } });
  return ok({ id: updated.id, status: updated.status, validation: { ok: validation.ok, issues: validation.issues } });
});

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("strategy.read");
  const { id } = await ctx.params;
  const sv = await prisma.strategyVersion.findUnique({ where: { id } });
  if (!sv) throw notFound("Strategy version not found");
  return ok({ ...sv, validation: validateStrategyConfig(sv.configJson) });
});
