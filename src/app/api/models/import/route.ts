import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";
import { ok, route, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, unprocessable } from "@/server/errors";
import { validateImportedPackage } from "@/server/modules/models/modelService";

const schema = z.object({ package: z.unknown(), owner: z.string().max(120).optional(), notes: z.string().max(600).optional(), columnMapping: z.record(z.string(), z.string()).optional() });

/**
 * Import a validated JSON rule package as a DRAFT model version. Rules are data (comparisons on named
 * features); nothing in the upload is executed. Golden cases run immediately and are stored with the version.
 */
export const POST = route(async (req) => {
  const user = await requireUser("model.draft");
  const body = await parseBody(req, schema);
  const v = validateImportedPackage(body.package);
  if (!v.ok) throw unprocessable("Rule package failed validation", v.errors);
  const pkg = v.pkg;
  const exists = await prisma.modelVersion.findUnique({ where: { modelCode_version: { modelCode: pkg.modelCode, version: pkg.version } } });
  if (exists) throw conflict(`Model ${pkg.modelCode} version ${pkg.version} already exists`);
  const checksum = "sha256:" + createHash("sha256").update(JSON.stringify(body.package)).digest("hex").slice(0, 32);
  const features = body.columnMapping ? pkg.features.map((f) => ({ ...f, sourceColumn: Object.entries(body.columnMapping!).find(([, canon]) => canon === f.name)?.[0] ?? null })) : pkg.features;
  const created = await prisma.modelVersion.create({
    data: {
      provider: pkg.provider,
      modelCode: pkg.modelCode,
      version: pkg.version,
      checksum,
      status: "DRAFT",
      source: `Imported by ${user.username} (JSON rule package)`,
      owner: body.owner ?? user.displayName,
      observationFrequency: "Monthly (declared by package; confirm with provider)",
      targetPopulation: pkg.population,
      targetEvent: pkg.targetEvent,
      horizon: pkg.horizon,
      rulesJson: pkg as never,
      featureDictionary: features as never,
      unresolvedIssues: (pkg.unresolvedIssues ?? []) as never,
      notes: `${body.notes ?? ""}\nGolden cases: ${v.golden.passed}/${v.golden.total} pass`.trim(),
    },
  });
  await appendAudit(prisma, { actorUserId: user.id, action: "model.imported", objectType: "ModelVersion", objectId: created.id, changes: { checksum, golden: v.golden } });
  return ok({ id: created.id, checksum, golden: v.golden });
});
