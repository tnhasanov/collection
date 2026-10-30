import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { getAgentContext } from "@/server/modules/dialer/agentSessionService";

export const dynamic = "force-dynamic";

/**
 * Lightweight "is there a call to return to?" check for the shell indicator on pages other than the call workspace.
 * Reads provider-confirmed state only; never changes anything.
 */
export async function GET() {
  try {
    const user = await requireUser("agent.desktop");
    const { reservation, interaction } = await getAgentContext(prisma, user.id);
    const live = !!reservation && ["PENDING", "AUTHORIZED", "DIALING", "CONNECTED"].includes(reservation.status);
    const unfinished = !!interaction && (interaction.status === "OPEN" || interaction.status === "DRAFT" || interaction.wrapUpStatus === "PENDING" || interaction.wrapUpStatus === "FAILED");
    if (!live && !unfinished) return ok({ active: false as const });
    const customerId = interaction?.customerId ?? reservation?.customerId ?? null;
    const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId }, select: { displayName: true } }) : null;
    const stage = interaction?.status === "OPEN" ? "LIVE" : interaction?.status === "DRAFT" ? "ACW" : interaction ? "WRAP_UP" : "DIALING";
    return ok({ active: true as const, stage, reservationId: reservation?.id ?? null, interactionId: interaction?.id ?? null, customerName: customer?.displayName ?? null });
  } catch (e) {
    return fail(e);
  }
}
