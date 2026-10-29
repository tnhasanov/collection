import "dotenv/config";
import { createPrismaClient } from "../src/server/db";
import { seedPilotReference } from "../prisma/seed/pilotReference";

/** Idempotent: adds pilot reference data (payment-instruction templates, related parties) to an existing database. */
async function main() {
  const prisma = createPrismaClient();
  try {
    const r = await seedPilotReference(prisma);
    console.log(JSON.stringify(r));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
