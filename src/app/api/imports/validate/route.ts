import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { validateImport } from "@/server/modules/imports/importService";

const schema = z.object({ dataset: z.string(), fileName: z.string().min(1).max(200), csv: z.string().min(1).max(5_000_000), mapping: z.record(z.string(), z.string().nullable()).optional() });

/** Step 1–3 of the wizard: upload text, propose/apply column mapping, validate and create the batch. */
export const POST = route(async (req) => {
  const user = await requireUser("import.write");
  const body = await parseBody(req, schema);
  return ok(await validateImport(prisma, { dataset: body.dataset, fileName: body.fileName, csvText: body.csv, mapping: body.mapping, createdBy: user.id, now: await now() }));
});
