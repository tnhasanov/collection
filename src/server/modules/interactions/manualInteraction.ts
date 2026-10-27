import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/server/db";
import { outcomeSchema } from "@/server/modules/interactions/outcomeSchema";
import { saveOutcome } from "@/server/modules/interactions/outcomeService";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";
import { appendAudit } from "@/server/modules/audit/audit";
import { conflict } from "@/server/errors";

export const manualInteractionSchema = z.object({
  customerId: z.string(),
  channel: z.enum(["VOICE_INBOUND", "MANUAL_NOTE", "VOICE_OUTBOUND"]),
  technicalResult: z.enum(["ANSWERED", "NO_ANSWER", "BUSY", "UNREACHABLE", "FAILED", "MACHINE"]),
  contactPointId: z.string().nullable().optional(),
  loanId: z.string().nullable().optional(),
  outcome: outcomeSchema,
});

/**
 * Records a contact that did not come through the automatic dialer (inbound call, manual note, supervisor-authorized
 * outbound). The same contact-policy and outcome services apply; an agent-initiated outbound call is only allowed when
 * the customer is eligible right now.
 */
export async function recordManualInteraction(db: Db, params: { actorUserId: string; input: unknown; now: Date }) {
  const input = manualInteractionSchema.parse(params.input);
  const customer = await db.customer.findUniqueOrThrow({ where: { id: input.customerId } });
  const c = await db.collectionCase.findFirst({ where: { customerId: input.customerId, status: { in: ["OPEN", "HANDOVER"] } } });
  if (input.channel === "VOICE_OUTBOUND") {
    const { decision } = await evaluateCustomerEligibility(db, input.customerId, { channel: "VOICE", now: params.now, contactPointId: input.contactPointId ?? null });
    if (!decision.eligible) throw conflict("Customer is not eligible for an outbound call right now", { code: "NOT_ELIGIBLE", reasonCodes: decision.reasonCodes, nextAllowedAt: decision.nextAllowedAt });
  }
  const correlationId = `manual-${randomUUID()}`;
  const interaction = await db.interaction.create({
    data: {
      correlationId,
      customerId: input.customerId,
      caseId: c?.id ?? null,
      loanId: input.loanId ?? null,
      agentUserId: params.actorUserId,
      channel: input.channel,
      contactPointId: input.contactPointId ?? null,
      startedAt: params.now,
      connectedAt: input.technicalResult === "ANSWERED" ? params.now : null,
      endedAt: params.now,
      acwStartedAt: params.now,
      technicalResult: input.technicalResult,
      status: "DRAFT",
      wrapUpStatus: "NOT_REQUIRED",
      dispositionVersion: "DISP-DEMO-01",
      scriptVersionId: (await db.template.findFirst({ where: { kind: "AGENT_SCRIPT", status: "ACTIVE", language: customer.language } }))?.id ?? null,
    },
  });
  await appendAudit(db, { actorUserId: params.actorUserId, action: "interaction.manual.created", objectType: "Interaction", objectId: interaction.id, customerId: input.customerId, caseId: c?.id ?? null, correlationId, changes: { channel: input.channel, technicalResult: input.technicalResult } });
  const result = await saveOutcome(db, { interactionId: interaction.id, actorUserId: params.actorUserId, input: input.outcome, now: params.now });
  return result;
}
