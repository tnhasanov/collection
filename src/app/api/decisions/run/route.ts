import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { runDailyDecision } from "@/server/modules/decisions/decisionRun";

/** Manual daily decision snapshot run (normally scheduled by the worker at 05:00 Asia/Baku). */
export async function POST() {
  try {
    const user = await requireUser("operations.manage");
    const run = await prisma.jobRun.create({ data: { name: "decision.daily", status: "RUNNING", detail: { triggeredBy: user.id } as never } });
    try {
      const summary = await runDailyDecision(prisma, { triggeredBy: `user:${user.username}`, now: await now() });
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), detail: summary as never } });
      return ok(summary);
    } catch (e) {
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: String(e) } });
      throw e;
    }
  } catch (e) {
    return fail(e);
  }
}
