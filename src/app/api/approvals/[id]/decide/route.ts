import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { decideApproval } from "@/server/modules/approvals/approvalService";
import { hasPermission } from "@/server/auth/permissions";
import { forbidden, notFound } from "@/server/errors";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT", "REQUEST_INFO"]), note: z.string().min(3).max(600) });

/** Checker decision. Governance requests need approval.decide; promise-date exceptions are decided by a lead/head (ptp-exception.decide). The maker can never decide their own request. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const ar = await prisma.approvalRequest.findUnique({ where: { id }, select: { type: true } });
  if (!ar) throw notFound("Approval request not found");
  const needed = ar.type === "PTP_EXCEPTION" ? "ptp-exception.decide" : "approval.decide";
  if (!hasPermission(user.role, needed)) throw forbidden(`Missing permission ${needed}`);
  const body = await parseBody(req, schema);
  return ok(await decideApproval(prisma, id, user, body.decision, body.note, await now()));
});
