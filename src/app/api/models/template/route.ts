import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { PROMETEIA_DRAFT_MODEL } from "@/server/modules/decisions/prometeiaDraftModel";

/** Example rule package (synthetic) for S13 imports. */
export const GET = route(async () => {
  await requireUser("model.read");
  const example = { ...PROMETEIA_DRAFT_MODEL, version: "EXAMPLE-IMPORT", provenance: "Synthetic example package for import testing" };
  return new Response(JSON.stringify(example, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="prometeia-rule-package-example.json"' } });
});
