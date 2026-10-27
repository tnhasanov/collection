import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { dryRunImport } from "@/server/modules/imports/importService";

export const POST = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("import.write");
  const { id } = await ctx.params;
  return ok(await dryRunImport(prisma, id, user.id));
});
