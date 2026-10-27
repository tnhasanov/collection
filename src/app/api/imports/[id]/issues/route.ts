import { prisma } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/errors";
import { toCsvText } from "@/server/modules/imports/csv";

/** Human-readable error file for a batch (CSV, formula-injection guarded). */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("import.write");
  const { id } = await ctx.params;
  const batch = await prisma.importBatch.findUnique({ where: { id }, include: { issues: { orderBy: { rowNumber: "asc" } } } });
  if (!batch) throw notFound("Import batch not found");
  const csv = toCsvText(["row", "severity", "code", "message", "row_data"], batch.issues.map((i) => [i.rowNumber ?? "", i.severity, i.code, i.message, i.rowJson ? JSON.stringify(i.rowJson) : ""]));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="import-${batch.dataset}-${id}-issues.csv"` } });
});
