import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { bakuBusinessDate } from "@/server/dates";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, notFound } from "@/server/errors";

const schema = z.object({ templateCode: z.string().default("SMS-REMINDER-01") });

/** Send an approved SMS: policy re-checked at dispatch; DEMO writes to the local outbound log only. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const { templateCode } = await parseBody(req, schema);
    const t = await now();
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id }, include: { loans: true } });
    const template = await prisma.template.findFirst({ where: { code: templateCode, status: "ACTIVE", language: customer.language, kind: { in: ["SMS", "PTP_REMINDER"] } } });
    if (!template) throw notFound("No approved active template for this language");
    const { decision, contactPointId } = await evaluateCustomerEligibility(prisma, id, { channel: "SMS", now: t });
    const key = `${templateCode}:${id}:${bakuBusinessDate(t)}:manual:${user.id}`;
    if (!decision.eligible || !contactPointId) {
      await prisma.outboundMessage.upsert({ where: { dedupKey: key }, create: { dedupKey: key, customerId: id, contactPointId, templateId: template.id, language: customer.language, body: "", status: "BLOCKED", blockReason: decision.reasonCodes.join(",") }, update: {} });
      await appendAudit(prisma, { actorUserId: user.id, action: "sms.blocked", objectType: "Customer", objectId: id, customerId: id, blocked: true, reason: decision.reasonCodes.join(",") });
      throw conflict("SMS blocked by contact policy", { reasonCodes: decision.reasonCodes, reasons: decision.reasonCodes.map((c) => REASON_LABELS[c] ?? c) });
    }
    const overdue = customer.loans.reduce((s, l) => s + Number(l.totalOverdue), 0).toFixed(2);
    const oldest = customer.loans.map((l) => l.oldestUnpaidDueDate).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
    const body = String((template.body as { text?: string }).text ?? "").replace("{{overdueAmount}}", overdue).replace("{{oldestDueDate}}", oldest ? oldest.toISOString().slice(0, 10) : "");
    const existing = await prisma.outboundMessage.findUnique({ where: { dedupKey: key } });
    if (existing) return ok({ messageId: existing.id, status: existing.status, duplicate: true });
    const msg = await prisma.outboundMessage.create({ data: { dedupKey: key, customerId: id, contactPointId, templateId: template.id, language: customer.language, body, status: "QUEUED" } });
    await prisma.outboxMessage.create({ data: { topic: "sms.send", idempotencyKey: `sms:${msg.id}`, payload: { outboundMessageId: msg.id } as never } });
    await appendAudit(prisma, { actorUserId: user.id, action: "sms.requested", objectType: "OutboundMessage", objectId: msg.id, customerId: id, changes: { template: `${template.code} v${template.version}`, policyVersion: decision.policyVersion } });
    return ok({ messageId: msg.id, status: "QUEUED", duplicate: false, note: "DEMO: written to the local outbound log; no real message is sent" });
  } catch (e) {
    return fail(e);
  }
}
