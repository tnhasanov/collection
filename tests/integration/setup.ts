import { execSync } from "node:child_process";
import { beforeAll } from "vitest";
import { Client } from "pg";
import { createPrismaClient } from "@/server/db";
import { seedDatabase } from "../../prisma/seed";

/** Integration tests run against TEST_DATABASE_URL: schema recreated, migrations applied, deterministic seed loaded once. */
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL must be set for integration tests");
process.env.DATABASE_URL = url;
process.env.APP_MODE = "DEMO";

beforeAll(async () => {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS pgboss CASCADE;");
  await client.end();
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
  const prisma = createPrismaClient(url);
  await seedDatabase(prisma);
  await prisma.$disconnect();
}, 300_000);
