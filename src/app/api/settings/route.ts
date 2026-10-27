import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { setSetting } from "@/server/modules/settings/settingsService";
import { appendAudit } from "@/server/modules/audit/audit";
import { DEFAULT_SETTINGS } from "@/server/modules/policy/defaults";
import { forbidden, notFound } from "@/server/errors";

const schema = z.object({ key: z.string(), value: z.unknown(), reason: z.string().min(3).max(300) });

/** Settings changes are audited with before/after values; the role must be in the parameter's editable roles (or settings.write). */
export async function PUT(req: Request) {
  try {
    const user = await requireUser("settings.read");
    const { key, value, reason } = await parseBody(req, schema);
    const def = DEFAULT_SETTINGS.find((d) => d.key === key);
    const current = await prisma.setting.findUnique({ where: { key } });
    if (!def && !current) throw notFound("Unknown setting");
    const editable = current?.editableRoles?.length ? current.editableRoles : def?.editableRoles ?? [];
    const allowed = editable.includes(user.role) || (user.role === "ADMIN" && key.startsWith("clock.")) || (user.role !== "ADMIN" && user.role !== "AUDITOR" && (await import("@/server/auth/permissions")).hasPermission(user.role, "settings.write"));
    if (!allowed) throw forbidden("Your role cannot edit this parameter");
    if (key.startsWith("model.") || key.startsWith("contactPolicy.")) {
      // Policy-grade parameters require maker/checker: record an approval request instead of applying directly.
      const ar = await prisma.approvalRequest.create({ data: { type: "POLICY_ACTIVATION", makerUserId: user.id, objectType: "Setting", objectId: key, title: `Change setting ${key}`, rationale: reason, beforeJson: (current?.value ?? def?.value ?? null) as never, afterJson: value as never } });
      await appendAudit(prisma, { actorUserId: user.id, action: "setting.change_requested", objectType: "Setting", objectId: key, reason, changes: { approvalId: ar.id } });
      return ok({ pendingApproval: ar.id, note: "Policy/model parameters need independent approval (S11) before they take effect" });
    }
    const updated = await setSetting(prisma, key, value, user.id);
    await appendAudit(prisma, { actorUserId: user.id, action: "setting.changed", objectType: "Setting", objectId: key, reason, changes: { before: current?.value ?? def?.value ?? null, after: value } });
    return ok({ key: updated.key, value: updated.value, version: updated.version });
  } catch (e) {
    return fail(e);
  }
}
