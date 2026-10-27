import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { rollbackImport } from "@/server/modules/imports/importService";

const schema = z.object({ reason: z.string().min(3).max(300) });

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("import.write");
  const { id } = await ctx.params;
  const { reason } = await parseBody(req, schema);
  return ok(await rollbackImport(prisma, id, user.id, await now(), reason));
});
