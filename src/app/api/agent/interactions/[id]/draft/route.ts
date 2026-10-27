import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { draftSchema } from "@/server/modules/interactions/outcomeSchema";
import { saveDraft } from "@/server/modules/interactions/outcomeService";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    const draft = await parseBody(req, draftSchema);
    const i = await saveDraft(prisma, { interactionId: id, actorUserId: user.id, draft, now: await now() });
    return ok({ draftSavedAt: i.draftSavedAt, status: i.status });
  } catch (e) {
    return fail(e);
  }
}
