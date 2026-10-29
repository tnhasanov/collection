import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { getActiveSession } from "@/server/modules/dialer/agentSessionService";
import { providerCapabilities } from "@/server/modules/agent/agentDesktopService";
import { readControlState } from "@/server/modules/dialer/contract";
import { conflict, forbidden, notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";

const schema = z.object({ interactionId: z.string(), action: z.enum(["MUTE", "UNMUTE", "HOLD", "RESUME", "TRANSFER", "END"]) });

/**
 * Call controls are requests to the provider (through the outbox); the provider's confirmation, rejection or silence
 * is written back to the interaction's control state, which the desktop renders as pending / confirmed / error.
 * Only capabilities the adapter reports are accepted.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { interactionId, action } = await parseBody(req, schema);
    const caps = await providerCapabilities(prisma);
    const supported = action === "END" ? caps.end : action === "TRANSFER" ? caps.transfer : action === "MUTE" || action === "UNMUTE" ? caps.mute : caps.hold;
    if (!supported) throw conflict(`${action} is not supported by the connected provider${caps.provider ? ` (${caps.provider})` : ""}`, { code: "UNSUPPORTED" });
    const interaction = await prisma.interaction.findUnique({ where: { id: interactionId } });
    if (!interaction) throw notFound("Interaction not found");
    if (interaction.agentUserId !== user.id) throw forbidden("Not your interaction");
    if (interaction.status !== "OPEN") throw conflict("The call is not active", { code: "CALL_NOT_ACTIVE" });
    const t = await now();
    const state = readControlState(interaction.controlState);
    if (state.pending.some((p) => p.action === action)) return ok({ requested: action, pending: true, duplicate: true });
    if ((action === "MUTE" && state.muted) || (action === "UNMUTE" && !state.muted) || (action === "HOLD" && state.held) || (action === "RESUME" && !state.held)) return ok({ requested: action, alreadyInState: true });
    const session = await getActiveSession(prisma, user.id);
    const key = `ctl:${action}:${interactionId}:${action === "END" ? "once" : t.getTime()}`;
    const next = { ...state, pending: [...state.pending, { action, key, requestedAt: t.toISOString() }], lastError: null, lastErrorAt: null, endRequestedAt: action === "END" ? t.toISOString() : state.endRequestedAt, updatedAt: t.toISOString() };
    await prisma.interaction.update({ where: { id: interactionId }, data: { controlState: next as never } });
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId, action, agentRef: session?.providerAgentRef ?? null }, key, interaction.correlationId);
    await appendAudit(prisma, { actorUserId: user.id, action: `call.control.${action.toLowerCase()}`, objectType: "Interaction", objectId: interactionId, customerId: interaction.customerId, correlationId: interaction.correlationId });
    return ok({ requested: action, pending: true, key });
  } catch (e) {
    return fail(e);
  }
}
