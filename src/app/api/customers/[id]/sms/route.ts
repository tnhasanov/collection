import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { bakuBusinessDate } from "@/server/dates";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { REASON_LABELS } from "@/server/modules/contactPolicy/evaluator";
import { renderTemplate, templateText, variablesForCustomer } from "@/server/modules/templates/templateService";
import { smsCost } from "@/server/modules/promises/reminderService";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict, forbidden, notFound } from "@/server/errors";

const TEMPLATES = { "SMS-REMINDER-01": "MANUAL", "PAY-INSTRUCTIONS-01": "PAYMENT_INSTRUCTIONS" } as const;
const schema = z.object({ templateCode: z.enum(["SMS-REMINDER-01", "PAY-INSTRUCTIONS-01"]).default("SMS-REMINDER-01"), interactionId: z.string().nullable().optional(), rpcConfirmed: z.boolean().optional() });

/**
 * Send an approved SMS to the customer: the contact policy is re-checked at dispatch and the body is rendered from
 * the active template for the customer's language. Payment instructions are sent from the current call only
 * (the agent's own open or draft interaction, right party verified). Synthetic modes write to the local outbound
 * log; segments and the estimated cost are recorded for every message.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    await requireCustomerAccess(prisma, user, id);
    const { templateCode, interactionId, rpcConfirmed } = await parseBody(req, schema);
    const t = await now();
    const kind = TEMPLATES[templateCode];
    if (kind === "PAYMENT_INSTRUCTIONS") {
      if (!interactionId) throw conflict("Payment instructions are sent from the current call", { code: "NO_INTERACTION" });
      const i = await prisma.interaction.findUnique({ where: { id: interactionId } });
      if (!i || i.customerId !== id) throw notFound("Interaction not found for this customer");
      if (i.agentUserId !== user.id) throw forbidden("This interaction belongs to another agent");
      if (!["OPEN", "DRAFT"].includes(i.status)) throw conflict("The call is already wrapped up; payment instructions can only be sent during the call or its after-call work", { code: "CALL_CLOSED" });
      if (!rpcConfirmed) throw conflict("Verify the right party before sending payment details", { code: "RPC_REQUIRED" });
    }
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });
    const template = (await prisma.template.findFirst({ where: { code: templateCode, status: "ACTIVE", language: customer.language, kind: { in: ["SMS", "PTP_REMINDER"] } } })) ?? (await prisma.template.findFirst({ where: { code: templateCode, status: "ACTIVE", language: "AZ", kind: { in: ["SMS", "PTP_REMINDER"] } } }));
    if (!template) throw notFound("No approved active template for this language");
    const { decision, contactPointId: evaluatedContact } = await evaluateCustomerEligibility(prisma, id, { channel: "SMS", now: t });
    // During the agent's own call the customer is reserved by that very agent: the reservation-uniqueness check is not a
    // reason to withhold payment instructions. Every other policy check (consent, hours, limits, holds) still applies.
    const blocking = decision.reasonCodes.filter((c) => !(kind === "PAYMENT_INSTRUCTIONS" && c === "NOT_RESERVED_ELSEWHERE"));
    const fallbackContact = kind === "PAYMENT_INSTRUCTIONS" && !evaluatedContact ? (await prisma.contactPoint.findFirst({ where: { customerId: id, type: "MOBILE", verification: "VERIFIED", restricted: false }, orderBy: { isPrimary: "desc" } }))?.id ?? null : null;
    const contactPointId = evaluatedContact ?? fallbackContact;
    const eligible = blocking.length === 0 && !!contactPointId;
    const key = `${templateCode}:${id}:${bakuBusinessDate(t)}:manual:${user.id}${interactionId ? `:${interactionId}` : ""}`;
    const body = renderTemplate(templateText(template.body), await variablesForCustomer(prisma, id, user.displayName));
    const cost = await smsCost(prisma, body);
    if (!eligible) {
      await prisma.outboundMessage.upsert({ where: { dedupKey: key }, create: { dedupKey: key, customerId: id, contactPointId, templateId: template.id, language: template.language, body, status: "BLOCKED", blockReason: blocking.join(",") || "NO_VERIFIED_MOBILE", kind, segments: cost.segments, estimatedCost: cost.estimatedCost }, update: {} });
      await appendAudit(prisma, { actorUserId: user.id, action: "sms.blocked", objectType: "Customer", objectId: id, customerId: id, blocked: true, reason: blocking.join(",") || "NO_VERIFIED_MOBILE", changes: { templateCode, interactionId: interactionId ?? null } });
      throw conflict("SMS blocked by contact policy", { reasonCodes: blocking, reasons: blocking.length ? blocking.map((c) => REASON_LABELS[c] ?? c) : ["No verified mobile number"] });
    }
    const existing = await prisma.outboundMessage.findUnique({ where: { dedupKey: key } });
    if (existing) return ok({ messageId: existing.id, status: existing.status, duplicate: true, segments: existing.segments, estimatedCost: existing.estimatedCost?.toString() ?? null });
    const msg = await prisma.outboundMessage.create({ data: { dedupKey: key, customerId: id, contactPointId, templateId: template.id, language: template.language, body, status: "QUEUED", kind, segments: cost.segments, estimatedCost: cost.estimatedCost } });
    await prisma.outboxMessage.create({ data: { topic: "sms.send", idempotencyKey: `sms:${msg.id}`, payload: { outboundMessageId: msg.id } as never } });
    await appendAudit(prisma, { actorUserId: user.id, action: "sms.requested", objectType: "OutboundMessage", objectId: msg.id, customerId: id, changes: { template: `${template.code} v${template.version}`, kind, policyVersion: decision.policyVersion, segments: cost.segments, estimatedCost: cost.estimatedCost, interactionId: interactionId ?? null, rpcConfirmed: rpcConfirmed ?? null } });
    return ok({ messageId: msg.id, status: "QUEUED", duplicate: false, segments: cost.segments, encoding: cost.encoding, estimatedCost: cost.estimatedCost, note: "Synthetic mode: written to the local outbound log; no real message is sent" });
  } catch (e) {
    return fail(e);
  }
}
