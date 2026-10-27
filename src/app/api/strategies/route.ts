import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";

const schema = z.object({ fromId: z.string(), version: z.string().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/), notes: z.string().max(400).optional() });

/** Create a new DRAFT strategy version by cloning an existing version's configuration. */
export const POST = route(async (req) => {
  const user = await requireUser("strategy.draft");
  const body = await parseBody(req, schema);
  const from = await prisma.strategyVersion.findUnique({ where: { id: body.fromId } });
  if (!from) throw notFound("Source strategy version not found");
  const exists = await prisma.strategyVersion.findUnique({ where: { code_version: { code: from.code, version: body.version } } });
  if (exists) throw conflict(`Version ${body.version} already exists for ${from.code}`);
  const created = await prisma.strategyVersion.create({ data: { code: from.code, version: body.version, status: "DRAFT", configJson: from.configJson as never, createdBy: user.id, notes: body.notes ?? `Cloned from ${from.version}` } });
  await appendAudit(prisma, { actorUserId: user.id, action: "strategy.draft.created", objectType: "StrategyVersion", objectId: created.id, changes: { clonedFrom: from.id, version: body.version } });
  return ok({ id: created.id });
});
