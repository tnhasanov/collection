import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { HANDOVER_ACTIONS, transitionHandover } from "@/server/modules/recovery/recoveryService";

const schema = z.object({ action: z.enum(HANDOVER_ACTIONS), note: z.string().min(3).max(600) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("recovery.manage");
  const { id } = await ctx.params;
  const body = await parseBody(req, schema);
  return ok(await transitionHandover(prisma, id, body.action, user, body.note, await now()));
});
