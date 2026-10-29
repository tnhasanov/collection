import type { PrismaClient } from "@/generated/prisma/client";
import type { DialerAdapter, NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { bakuBusinessDate, bakuHourMinute, toDbDate } from "@/server/dates";
import { runDailyAging } from "@/server/modules/jobs/aging";
import { backfillAttributions } from "@/server/modules/payments/attribution";
import { maturePromises } from "@/server/modules/promises/promiseService";
import { dispatchDueReminders } from "@/server/modules/promises/reminderService";
import { refreshDueWork } from "@/server/modules/jobs/maintenance";
import { hydrateMockAdapter, reconcileProviderState } from "@/server/modules/dialer/providerReconciliation";
import { runDailyDecision } from "@/server/modules/decisions/decisionRun";
import { appendAudit } from "@/server/modules/audit/audit";

/**
 * Idempotent start-up catch-up for a worker that was down or restarted: provider state is rebuilt and reconciled,
 * loans are aged for the current business date, cash attribution is backfilled, promises mature, due work and
 * reminders are re-evaluated, and the daily decision run is executed if today's run is missing after its scheduled
 * hour. Every step is safe to repeat; nothing here depends on wall-clock scheduling having fired.
 */
export async function runCatchUp(prisma: PrismaClient, adapter: DialerAdapter, now: Date, scheduleEvents: (steps: { delayMs: number; event: NormalizedProviderEvent }[]) => Promise<void>, opts: { decisionHourBaku?: number } = {}) {
  const summary: Record<string, unknown> = { at: now.toISOString(), businessDate: bakuBusinessDate(now) };
  summary.hydrate = await hydrateMockAdapter(prisma, adapter);
  summary.aging = await runDailyAging(prisma, now, { reason: "worker catch-up" });
  summary.attribution = await backfillAttributions(prisma, now);
  summary.promisesMatured = (await maturePromises(prisma, now)).length;
  summary.dueWork = await refreshDueWork(prisma, now);
  summary.reconcile = await reconcileProviderState(prisma, adapter, now, scheduleEvents);
  summary.reminders = await dispatchDueReminders(prisma, now);
  const hour = bakuHourMinute(now).hour;
  const decisionHour = opts.decisionHourBaku ?? 5;
  const todayRun = await prisma.decisionRun.findFirst({ where: { businessDate: toDbDate(bakuBusinessDate(now)), status: "COMPLETED" } });
  if (!todayRun && hour >= decisionHour) {
    try {
      const run = await runDailyDecision(prisma, { triggeredBy: "worker:catch-up", now });
      summary.decision = { runId: run.runId, population: run.population, scored: run.scored };
    } catch (e) {
      summary.decision = { error: String(e) };
    }
  } else {
    summary.decision = todayRun ? "already completed today" : `before ${decisionHour}:00 Baku`;
  }
  await appendAudit(prisma, { actorService: "worker", action: "worker.catch_up", objectType: "Worker", changes: summary });
  return summary;
}
