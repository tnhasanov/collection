import { writeFileSync } from "node:fs";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_LABELS } from "../src/server/auth/permissions";
const roles = Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[];
let md = "# Permissions matrix (server-enforced)\n\nGenerated from `src/server/auth/permissions.ts` by `npx tsx scripts/write-permissions-doc.ts`. Every API route and page checks the permission on the server; menus are never authorization. Object-level customer scope is enforced separately in `src/server/auth/access.ts` (agents see only customers assigned, reserved or recently worked by them; team leads see their team; `customer.read.unscoped` roles see all; every denied access attempt is audited).\n\n";
md += "| Permission | " + roles.map((r) => ROLE_LABELS[r]).join(" | ") + " |\n|---|" + roles.map(() => ":---:").join("|") + "|\n";
for (const p of PERMISSIONS) md += `| \`${p}\` | ` + roles.map((r) => (ROLE_PERMISSIONS[r].includes(p) ? "✓" : "")).join(" | ") + " |\n";
md += "\n## Notes\n\n- Maker/checker: `approval.request` creates requests; `approval.decide` decides them; the service refuses a checker who is also the maker even if a role held both.\n- `demo.switch-role` exists only in DEMO mode for the admin identity and is audited.\n- `support.restricted.read` grants access to restricted hardship details only to the owning reviewers (team lead / head); agents see a restriction flag, never the details.\n- Service accounts (`svc.core-feed`) can only post integration events and imports.\n";
writeFileSync("docs/PERMISSIONS.md", md);
console.log("wrote docs/PERMISSIONS.md");
