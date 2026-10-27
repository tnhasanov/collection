import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { requireCustomerAccess } from "@/server/auth/access";
import { now } from "@/server/clock";
import { recordManualInteraction } from "@/server/modules/interactions/manualInteraction";

export async function POST(req: Request) {
  try {
    const user = await requireUser("interaction.write");
    const body = await req.json();
    if (typeof body?.customerId === "string") await requireCustomerAccess(prisma, user, body.customerId);
    const t = await now();
    const r = await prisma.$transaction((tx) => recordManualInteraction(tx, { actorUserId: user.id, input: body, now: t }), { timeout: 20_000 });
    return ok({ interactionId: r.interaction.id, nextAction: r.interaction.nextAction, effects: r.effects ?? null, preview: r.preview });
  } catch (e) {
    return fail(e);
  }
}
