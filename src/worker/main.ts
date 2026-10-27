import "dotenv/config";
import { PgBoss } from "pg-boss";
import os from "node:os";
import { createPrismaClient } from "@/server/db";
import { getClock } from "@/server/clock";
import { getDialerAdapter } from "@/server/modules/dialer/mockDialerAdapter";
import { processOutbox } from "@/server/modules/outbox/processor";
import { ingestProviderEvent } from "@/server/modules/dialer/providerEventService";
import { allocateForReadyAgents, expireStaleReservations, type ScheduleEvents } from "@/server/modules/dialer/routingService";
import type { NormalizedProviderEvent } from "@/server/modules/dialer/contract";
import { runDailyDecision } from "@/server/modules/decisions/decisionRun";
import { dispatchDigitalReminders, expireLeases, refreshDueWork, refreshMockSources, runPromiseMaturation } from "@/server/modules/jobs/maintenance";
import { evaluateCustomerEligibility } from "@/server/modules/contactPolicy/contextBuilder";

/**
 * Durable background worker (pg-boss on PostgreSQL). Owns the dialer adapter instance so provider state is
 * consistent; processes the transactional outbox, delivers mock provider events, allocates work to
 * confirmed-Ready agents, matures promises, refreshes mock sources and runs the daily decision snapshot.
 */
const QUEUES = {
  outbox: "outbox.dispatch",
  mockDeliver: "dialer.mock.deliver",
  allocate: "dialer.allocate",
  maintenance: "maintenance.tick",
  promises: "promise.mature",
  sources: "source.refresh",
  decision: "decision.daily",
  sms: "sms.dispatch",
} as const;

const WORKER_ID = `worker-${os.hostname()}-${process.pid}`;

async function main() {
  const prisma = createPrismaClient();
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: process.env.PGBOSS_SCHEMA ?? "pgboss" });
  boss.on("error", (e) => console.error("[pg-boss]", e));
  await boss.start();
  const adapter = getDialerAdapter();

  for (const q of Object.values(QUEUES)) await boss.createQueue(q, { retryLimit: 3, retryDelay: 2, retryBackoff: true });

  const scheduleEvents: ScheduleEvents = async (steps) => {
    for (const step of steps) {
      await boss.send(QUEUES.mockDeliver, { event: step.event }, { startAfter: Math.ceil(step.delayMs / 1000), singletonKey: step.event.providerEventId, retryLimit: 5 });
    }
  };

  await boss.work<{ event: NormalizedProviderEvent }>(QUEUES.mockDeliver, { batchSize: 5 }, async (jobs) => {
    const now = (await getClock()).now();
    for (const job of jobs) {
      adapter.applyEvent(job.data.event);
      const r = await ingestProviderEvent(prisma, job.data.event, now, adapter);
      if (r.status !== "APPLIED") console.log(`[mock-dialer] ${job.data.event.eventType} ${r.status} ${r.note ?? ""}`);
    }
  });

  await boss.work(QUEUES.outbox, { batchSize: 1, pollingIntervalSeconds: 1 }, async () => {
    const now = (await getClock()).now();
    await processOutbox(prisma, adapter, scheduleEvents, now);
  });

  await boss.work(QUEUES.allocate, { batchSize: 1, pollingIntervalSeconds: 1 }, async () => {
    const now = (await getClock()).now();
    const results = await allocateForReadyAgents(prisma, now, adapter, scheduleEvents);
    for (const r of results) if (r.outcome === "RESERVED") console.log(`[routing] reserved ${r.customerId} for session ${r.sessionId}`);
    await expireStaleReservations(prisma, now, adapter);
  });

  await boss.work(QUEUES.maintenance, { batchSize: 1 }, async () => {
    const now = (await getClock()).now();
    await expireLeases(prisma, now);
    await refreshDueWork(prisma, now);
    await prisma.workerHeartbeat.upsert({ where: { id: WORKER_ID }, create: { id: WORKER_ID, hostname: os.hostname(), lastSeenAt: new Date(), version: "0.1.0" }, update: { lastSeenAt: new Date() } });
  });

  await boss.work(QUEUES.promises, { batchSize: 1 }, async () => {
    const now = (await getClock()).now();
    const r = await runPromiseMaturation(prisma, now);
    if (r.length) console.log(`[promises] matured ${r.length}`);
  });

  await boss.work(QUEUES.sources, { batchSize: 1 }, async () => {
    const now = (await getClock()).now();
    if (process.env.APP_MODE === "DEMO") await refreshMockSources(prisma, now);
  });

  await boss.work(QUEUES.sms, { batchSize: 1 }, async () => {
    const now = (await getClock()).now();
    const r = await dispatchDigitalReminders(prisma, now, async (customerId) => {
      const e = await evaluateCustomerEligibility(prisma, customerId, { channel: "SMS", now, campaignCode: "SMS_REMINDER_DAILY" });
      return { eligible: e.decision.eligible, reasonCodes: e.decision.reasonCodes, contactPointId: e.contactPointId };
    });
    if (r.queued || r.blocked) console.log(`[sms] queued ${r.queued} blocked ${r.blocked}`);
  });

  await boss.work(QUEUES.decision, { batchSize: 1 }, async () => {
    const now = (await getClock()).now();
    const run = await prisma.jobRun.create({ data: { name: "decision.daily", status: "RUNNING" } });
    try {
      const summary = await runDailyDecision(prisma, { triggeredBy: "worker:decision.daily", now });
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date(), detail: summary as never } });
      console.log(`[decision] run ${summary.runId}: ${summary.population} customers, ${summary.scored} scored`);
    } catch (e) {
      await prisma.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), error: String(e) } });
      throw e;
    }
  });

  // Recurring schedules (cron in Asia/Baku). Tick queues use short intervals via singleton jobs.
  await boss.schedule(QUEUES.decision, "0 5 * * *", {}, { tz: "Asia/Baku" });
  await boss.schedule(QUEUES.sources, "*/2 * * * *", {});
  await boss.schedule(QUEUES.promises, "* * * * *", {});
  await boss.schedule(QUEUES.sms, "*/5 * * * *", {});
  const tick = async () => {
    await boss.send(QUEUES.outbox, {}, { singletonKey: "tick", singletonSeconds: 1 });
    await boss.send(QUEUES.allocate, {}, { singletonKey: "tick", singletonSeconds: 2 });
    await boss.send(QUEUES.maintenance, {}, { singletonKey: "tick", singletonSeconds: 15 });
  };
  await tick();
  const interval = setInterval(() => void tick().catch((e) => console.error("[tick]", e)), 1000);

  console.log(`[worker] ${WORKER_ID} started (mode ${process.env.APP_MODE}, dialer ${(await adapter.capabilities()).provider})`);
  const shutdown = async () => {
    clearInterval(interval);
    await boss.stop({ graceful: true });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = process.argv[1] && (process.argv[1].endsWith("main.ts") || process.argv[1].endsWith("main.js"));
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
