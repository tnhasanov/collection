import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/errors";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("import.write");
  const { id } = await ctx.params;
  const batch = await prisma.importBatch.findUnique({ where: { id }, include: { issues: { orderBy: { rowNumber: "asc" }, take: 200 } } });
  if (!batch) throw notFound("Import batch not found");
  const payload = batch.payloadJson as { accepted?: unknown[]; dryRun?: unknown; commit?: unknown } | null;
  return ok({ ...batch, payloadJson: undefined, acceptedPreview: (payload?.accepted ?? []).slice(0, 20), dryRun: payload?.dryRun ?? null, commit: payload?.commit ?? null });
});
