import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { saveOutcome } from "@/server/modules/interactions/outcomeService";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    const body = await req.json();
    const t = await now();
    const result = await prisma.$transaction(async (tx) => saveOutcome(tx, { interactionId: id, actorUserId: user.id, input: body, now: t }), { timeout: 20_000, maxWait: 5_000 });
    return ok({ duplicate: result.duplicate, interactionId: result.interaction.id, status: result.interaction.status, wrapUpStatus: result.interaction.wrapUpStatus, nextAction: result.interaction.nextAction, preview: result.preview, effects: result.effects ?? null });
  } catch (e) {
    return fail(e);
  }
}
