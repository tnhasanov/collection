import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requestRollback } from "@/server/modules/approvals/approvalService";

const schema = z.object({ objectType: z.enum(["StrategyVersion", "ModelVersion"]), objectId: z.string(), rationale: z.string().min(5).max(600) });

export const POST = route(async (req) => {
  const user = await requireUser("approval.request");
  const body = await parseBody(req, schema);
  const ar = await requestRollback(prisma, body, user);
  return ok({ approvalId: ar.id });
});
