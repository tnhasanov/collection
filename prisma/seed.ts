import "dotenv/config";
import { createPrismaClient } from "@/server/db";
import { createRng } from "./seed/rng";
import { seedReference } from "./seed/reference";
import { seedPortfolio } from "./seed/portfolio";
import { seedScenarios, seedScenarioHistory } from "./seed/scenarios";
import { restateLoansAndCases, runDecisionsAndTasks, setDemoClock } from "./seed/finalize";

/**
 * Deterministic synthetic dataset for ATB Collections (DEMO mode).
 * Business date 27 Oct 2026 (Asia/Baku). No real customer data is used anywhere.
 */
export async function seedDatabase(prisma: ReturnType<typeof createPrismaClient>) {
  if (process.env.APP_MODE !== "DEMO") throw new Error("Seeding synthetic data is only allowed in DEMO mode");
  const started = Date.now();
  const rng = createRng(20261027);

  const existing = await prisma.customer.count();
  if (existing > 0) {
    console.log(`Database already has ${existing} customers; run 'npm run db:reset' for a clean reseed.`);
    return null;
  }

  console.log("1/6 reference data (users, teams, versions, templates, campaigns, watermarks, metrics)");
  await seedReference(prisma);
  console.log("2/6 synthetic portfolio");
  const ids = await seedPortfolio(prisma, rng);
  console.log(`    ${ids.length} generated customers`);
  console.log("3/6 named demo scenarios");
  await seedScenarios(prisma, rng);
  console.log("4/6 restating loan balances and opening cases (same services as runtime)");
  await restateLoansAndCases(prisma);
  console.log("5/6 history: calls, promises, claims, support cases, SMS log");
  await seedScenarioHistory(prisma, rng);
  console.log("6/6 daily decision run, tasks and demo clock");
  const summary = await runDecisionsAndTasks(prisma);
  await setDemoClock(prisma);

  const [customers, loans, cases, workItems, interactions, promises] = await Promise.all([
    prisma.customer.count(),
    prisma.loan.count(),
    prisma.collectionCase.count({ where: { status: "OPEN" } }),
    prisma.workItem.count({ where: { status: { in: ["QUEUED", "ELIGIBLE", "DEFERRED"] } } }),
    prisma.interaction.count(),
    prisma.promise.count(),
  ]);
  const result = { customers, loans, openCases: cases, activeWorkItems: workItems, interactions, promises, decision: summary, seconds: Math.round((Date.now() - started) / 1000) };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const prisma = createPrismaClient();
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith("seed.ts");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
