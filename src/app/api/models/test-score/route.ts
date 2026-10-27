import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { notFound } from "@/server/errors";
import { testScore } from "@/server/modules/models/modelService";

const schema = z.object({
  features: z.record(z.string(), z.number().nullable()),
  dpd: z.number().int().min(0).max(3650),
  exposure: z.string().regex(/^\d+(\.\d{1,2})?$/),
  featuresAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  modelVersionId: z.string().nullable().optional(),
});

/** Score a test case through the typed interpreter (no persistence). */
export const POST = route(async (req) => {
  await requireUser("model.read");
  const body = await parseBody(req, schema);
  const r = await testScore(prisma, { features: body.features, dpd: body.dpd, exposure: body.exposure, featuresAsOf: body.featuresAsOf ?? null, modelVersionId: body.modelVersionId ?? null }, await now());
  if (!r) throw notFound("No model version available");
  return ok(r);
});
