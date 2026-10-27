import { route } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { notFound } from "@/server/errors";
import { datasetSpec } from "@/server/modules/imports/datasets";
import { toCsvText } from "@/server/modules/imports/csv";

/** Downloadable synthetic CSV example for a dataset. */
export const GET = route(async (_req, ctx: { params: Promise<{ dataset: string }> }) => {
  await requireUser("import.write");
  const { dataset } = await ctx.params;
  const spec = datasetSpec(dataset);
  if (!spec) throw notFound("Unknown dataset");
  const [headers, ...rows] = spec.example;
  return new Response(toCsvText(headers, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="atb-import-template-${spec.code}.csv"` } });
});
