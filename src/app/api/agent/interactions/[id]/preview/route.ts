import { prisma } from "@/server/db";
import { ok, fail, parseBody } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { outcomeSchema } from "@/server/modules/interactions/outcomeSchema";
import { computeNextAction, summaryContextFor } from "@/server/modules/interactions/outcomeService";
import { getContactPolicy } from "@/server/modules/settings/settingsService";
import { getPromisePolicy } from "@/server/modules/promises/promiseService";
import { currentLocale } from "@/i18n/locale";
import { notFound, forbidden } from "@/server/errors";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("interaction.write");
    const { id } = await ctx.params;
    const input = await parseBody(req, outcomeSchema);
    const interaction = await prisma.interaction.findUnique({ where: { id } });
    if (!interaction) throw notFound("Interaction not found");
    if (interaction.agentUserId !== user.id) throw forbidden("Not your interaction");
    const policy = await getContactPolicy(prisma);
    return ok(computeNextAction(input, { now: await now(), policy, technicalResult: interaction.technicalResult, customer: await summaryContextFor(prisma, interaction.customerId), promisePolicy: await getPromisePolicy(prisma), locale: await currentLocale() }));
  } catch (e) {
    return fail(e);
  }
}
