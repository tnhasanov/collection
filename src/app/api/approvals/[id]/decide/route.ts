import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { decideApproval } from "@/server/modules/approvals/approvalService";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT", "REQUEST_INFO"]), note: z.string().min(3).max(600) });

/** Checker decision (approval.decide). The maker can never decide their own request. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("approval.decide");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  return ok(await decideApproval(prisma, id, user, body.decision, body.note, await now()));
});
