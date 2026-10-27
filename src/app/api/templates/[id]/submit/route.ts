import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { submitTemplate } from "@/server/modules/templates/templateService";

const schema = z.object({ rationale: z.string().min(5).max(600), effectiveAt: z.string().datetime({ offset: true }).nullable().optional() });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("approval.request");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const ar = await submitTemplate(prisma, id, user, body.rationale, body.effectiveAt ? new Date(body.effectiveAt) : null);
  return ok({ approvalId: ar.id });
});
