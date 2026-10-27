import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { forbidden } from "@/server/errors";
import { hasPermission } from "@/server/auth/permissions";
import { ARRANGEMENT_ACTIONS, transitionArrangement } from "@/server/modules/arrangements/arrangementService";

const schema = z.object({ action: z.enum(ARRANGEMENT_ACTIONS), note: z.string().min(3).max(600) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("customer.read");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  const needs = body.action === "SUBMIT" ? "arrangement.write" : body.action === "REQUEST_APPROVAL" ? "approval.request" : "arrangement.review";
  if (!hasPermission(user.role, needs) && !(body.action === "SUBMIT" && hasPermission(user.role, "arrangement.review"))) throw forbidden(`Missing permission ${needs}`);
  return ok(await transitionArrangement(prisma, id, body.action, user, body.note, await now()));
});
