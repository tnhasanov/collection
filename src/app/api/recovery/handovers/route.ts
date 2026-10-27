import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { createHandover } from "@/server/modules/recovery/recoveryService";

const schema = z.object({ caseId: z.string(), receivingTeam: z.string().min(2).max(80), deadline: z.string().datetime({ offset: true }).nullable().optional() });

export const POST = route(async (req) => {
  const user = await requireUser("recovery.manage");
  const body = await parseBody(req, schema);
  const h = await createHandover(prisma, body.caseId, body.receivingTeam, body.deadline ? new Date(body.deadline) : null, user, await now());
  return ok({ id: h.id });
});
