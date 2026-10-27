import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { commitImport } from "@/server/modules/imports/importService";

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("import.write");
  const { id } = await ctx.params;
  return ok(await commitImport(prisma, id, user.id, await now()));
});
