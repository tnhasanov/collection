import { z } from "zod";
import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { enqueueOutbox } from "@/server/modules/outbox/outbox";
import { getActiveSession } from "@/server/modules/dialer/agentSessionService";
import { conflict, forbidden, notFound } from "@/server/errors";
import { appendAudit } from "@/server/modules/audit/audit";

const schema = z.object({ interactionId: z.string(), action: z.enum(["MUTE", "UNMUTE", "HOLD", "RESUME", "TRANSFER", "END"]) });

/** Supported call controls are routed to the provider through the outbox; unsupported ones are refused explicitly. */
export async function POST(req: Request) {
  try {
    const user = await requireUser("agent.desktop");
    const { interactionId, action } = await parseBody(req, schema);
    if (action === "TRANSFER") throw conflict("Transfer is not supported by the mock provider (capability flag off)", { code: "UNSUPPORTED" });
    const interaction = await prisma.interaction.findUnique({ where: { id: interactionId } });
    if (!interaction) throw notFound("Interaction not found");
    if (interaction.agentUserId !== user.id) throw forbidden("Not your interaction");
    if (interaction.status !== "OPEN") throw conflict("The call is not active", { code: "CALL_NOT_ACTIVE" });
    const session = await getActiveSession(prisma, user.id);
    const key = `ctl:${action}:${interactionId}:${action === "END" ? "once" : Date.now()}`;
    await enqueueOutbox(prisma, "dialer.callControl", { interactionId, action, agentRef: session?.providerAgentRef ?? null }, key, interaction.correlationId);
    await appendAudit(prisma, { actorUserId: user.id, action: `call.control.${action.toLowerCase()}`, objectType: "Interaction", objectId: interactionId, customerId: interaction.customerId, correlationId: interaction.correlationId });
    return ok({ requested: action });
  } catch (e) {
    return fail(e);
  }
}
