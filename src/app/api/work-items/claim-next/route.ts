import { prisma } from "@/server/db";
import { ok, fail } from "@/server/http";
import { requireUser } from "@/server/auth/session";
import { now } from "@/server/clock";
import { claimNextWorkItem } from "@/server/modules/work/workItemService";

/** Controlled manual/supervisor fallback. Normal agent flow is automatic dialer allocation (S28). */
export async function POST() {
  try {
    const user = await requireUser("queue.claim");
    const t = await now();
    const result = await prisma.$transaction((tx) => claimNextWorkItem(tx, { userId: user.id, seniority: user.seniority, languages: user.languages, now: t, manual: true }), { timeout: 20_000 });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
