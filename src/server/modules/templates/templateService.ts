import type { Db } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import type { Language, TemplateKind } from "@/generated/prisma/enums";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound, unprocessable } from "@/server/errors";
import { formatDate } from "@/server/dates";

/**
 * Templates and scripts (S16). Variables are schema-validated against an allow-list; previews use synthetic
 * customers; SMS length/encoding/segment estimates follow the configured provider rules (GSM-7 160/153,
 * UCS-2 70/67). Activation is four-eyes via S11. No real message is ever sent from the demo.
 */
export const ALLOWED_VARIABLES: Record<string, { description: string; sample: string }> = {
  agentName: { description: "Agent display name", sample: "Aysel" },
  customerName: { description: "Customer display name", sample: "Rashad Mammadov" },
  overdueAmount: { description: "Total overdue AZN (fresh balances only)", sample: "499.24" },
  oldestDueDate: { description: "Oldest unpaid due date", sample: "20.10.2026" },
  dpd: { description: "Days past due", sample: "7" },
  promiseAmount: { description: "Promised amount AZN", sample: "499.24" },
  promiseDate: { description: "Promise deadline", sample: "30.10.2026" },
  nextDueDate: { description: "Next scheduled due date", sample: "20.11.2026" },
  nextDueAmount: { description: "Next installment AZN", sample: "499.24" },
  branch: { description: "Home branch", sample: "Baku-Central" },
  loanRef: { description: "Core loan reference of the oldest overdue loan", sample: "CORE-L-DEMO-001" },
};
const SENSITIVE = [/court/i, /police/i, /criminal/i, /arrest/i, /məhkəmə/i, /polis/i, /суд/i, /полиц/i, /тюрьм/i, /prison/i];

const GSM7 = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function smsInfo(text: string) {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  const length = [...text].length;
  const encoding = gsm ? "GSM-7" : "UCS-2";
  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const effective = gsm ? units : length;
  const segments = effective === 0 ? 0 : effective <= single ? 1 : Math.ceil(effective / multi);
  return { length, encoding, units: effective, segments, singleLimit: single, multipartLimit: multi, note: gsm ? "GSM-7 (Latin + extension chars count double)" : "Non-GSM characters (Azerbaijani ə/ş/ğ, Cyrillic): UCS-2, 70 chars per segment" };
}

export function extractVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))];
}

export function validateTemplateText(text: string, kind: TemplateKind) {
  const issues: { severity: "ERROR" | "WARNING"; message: string }[] = [];
  const vars = extractVariables(text);
  for (const v of vars) if (!ALLOWED_VARIABLES[v]) issues.push({ severity: "ERROR", message: `Variable {{${v}}} is not in the allow-list` });
  if (/\{\{[^}]*$/.test(text) || /\{[^{]/.test(text.replace(/\{\{[^}]*\}\}/g, ""))) issues.push({ severity: "ERROR", message: "Unbalanced variable braces" });
  for (const re of SENSITIVE) if (re.test(text)) issues.push({ severity: "ERROR", message: `Restricted sensitive content matches ${re.source}` });
  if (kind === "SMS" || kind === "PTP_REMINDER") {
    const info = smsInfo(text);
    if (info.segments > 2) issues.push({ severity: "WARNING", message: `${info.segments} SMS segments (${info.encoding}); consider shortening` });
    if (!/ATB/.test(text)) issues.push({ severity: "WARNING", message: "Sender identification 'ATB' is missing" });
  }
  if (text.trim().length === 0) issues.push({ severity: "ERROR", message: "Template text is empty" });
  return { ok: !issues.some((i) => i.severity === "ERROR"), issues, variables: vars };
}

export function renderTemplate(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_m, k: string) => vars[k] ?? `{{${k}}}`);
}

/** Variable values for a real (synthetic) customer, or the sample set. */
export async function variablesForCustomer(db: Db, customerId: string | null, agentName = "Agent"): Promise<Record<string, string>> {
  const sample = Object.fromEntries(Object.entries(ALLOWED_VARIABLES).map(([k, v]) => [k, v.sample]));
  if (!customerId) return sample;
  const c = await db.customer.findUnique({ where: { id: customerId }, include: { loans: { where: { status: "ACTIVE" } }, promises: { where: { status: "ACTIVE" }, orderBy: { deadline: "asc" }, take: 1 } } });
  if (!c) return sample;
  const overdue = c.loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2);
  const oldest = c.loans.map((l) => l.oldestUnpaidDueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  const next = c.loans.map((l) => ({ d: l.nextDueDate, a: l.nextDueAmount })).filter((x) => x.d).sort((a, b) => a.d!.getTime() - b.d!.getTime())[0];
  const p = c.promises[0];
  const overdueLoan = [...c.loans].filter((l) => Number(l.totalOverdue) > 0).sort((a, b) => (a.oldestUnpaidDueDate?.getTime() ?? 0) - (b.oldestUnpaidDueDate?.getTime() ?? 0))[0] ?? c.loans[0];
  return { ...sample, agentName, customerName: c.displayName, overdueAmount: overdue, oldestDueDate: oldest ? formatDate(oldest) : "—", loanRef: overdueLoan?.coreLoanId ?? "—", dpd: String(c.loans.reduce((m, l) => Math.max(m, l.dpd), 0)), promiseAmount: p ? p.amount.toString() : sample.promiseAmount, promiseDate: p ? formatDate(p.deadlineDate) : sample.promiseDate, nextDueDate: next?.d ? formatDate(next.d) : "—", nextDueAmount: next?.a ? next.a.toString() : "—", branch: c.branch };
}

export function templateText(body: unknown): string {
  const b = body as { text?: string; steps?: { title: string; text: string }[] } | null;
  if (b?.text) return b.text;
  if (b?.steps) return b.steps.map((s) => `${s.title}: ${s.text}`).join("\n\n");
  return "";
}

export async function createTemplateVersion(db: Db, input: { fromId?: string | null; code: string; version: string; kind: TemplateKind; language: Language; title: string; text: string; channelScope: string[]; fallbackLanguage?: Language | null }, user: SessionUser) {
  const v = validateTemplateText(input.text, input.kind);
  if (!v.ok) throw unprocessable("Template validation failed", v.issues);
  const exists = await db.template.findUnique({ where: { code_version_language: { code: input.code, version: input.version, language: input.language } } });
  if (exists) throw conflict(`Template ${input.code} ${input.version} (${input.language}) already exists`);
  const from = input.fromId ? await db.template.findUnique({ where: { id: input.fromId } }) : null;
  const body = from && (from.body as { steps?: unknown }).steps ? { ...(from.body as object), text: input.text } : { text: input.text, fallbackLanguage: input.fallbackLanguage ?? null };
  const t = await db.template.create({ data: { code: input.code, version: input.version, kind: input.kind, language: input.language, status: "DRAFT", title: input.title, body: body as never, variables: v.variables, channelScope: input.channelScope, createdBy: user.id } });
  await appendAudit(db, { actorUserId: user.id, action: "template.draft.created", objectType: "Template", objectId: t.id, changes: { from: from?.id ?? null, issues: v.issues } });
  return t;
}

export async function submitTemplate(prisma: PrismaClient, id: string, user: SessionUser, rationale: string, effectiveAt: Date | null) {
  const t = await prisma.template.findUnique({ where: { id } });
  if (!t) throw notFound("Template not found");
  if (t.status !== "DRAFT" && t.status !== "TESTED") throw conflict(`Template is ${t.status}`);
  const v = validateTemplateText(templateText(t.body), t.kind);
  if (!v.ok) throw unprocessable("Template validation failed", v.issues);
  const open = await prisma.approvalRequest.findFirst({ where: { objectType: "Template", objectId: id, status: { in: ["PENDING", "INFO_REQUESTED"] } } });
  if (open) throw conflict(`Approval ${open.id} already open`);
  const active = await prisma.template.findFirst({ where: { code: t.code, language: t.language, status: "ACTIVE" } });
  const ar = await prisma.approvalRequest.create({ data: { type: "TEMPLATE_ACTIVATION", makerUserId: user.id, objectType: "Template", objectId: id, title: `Activate template ${t.code} ${t.version} (${t.language})`, rationale, beforeJson: (active ? { id: active.id, version: active.version, text: templateText(active.body) } : null) as never, afterJson: { id: t.id, version: t.version, text: templateText(t.body), variables: t.variables, channelScope: t.channelScope } as never, validationJson: { issues: v.issues, sms: t.kind === "SMS" || t.kind === "PTP_REMINDER" ? smsInfo(templateText(t.body)) : null } as never, proposedEffectiveAt: effectiveAt, rollbackTargetId: active?.id ?? null } });
  await prisma.template.update({ where: { id }, data: { status: "TESTED" } });
  await appendAudit(prisma, { actorUserId: user.id, action: "approval.requested", objectType: "ApprovalRequest", objectId: ar.id, reason: rationale, changes: { type: "TEMPLATE_ACTIVATION", templateId: id } });
  return ar;
}
