/**
 * Demo database reset: drops the public and pg-boss schemas, re-applies migrations and seeds.
 * (Prisma 7 removed `migrate reset --skip-seed`; this script is the supported equivalent for the demo.)
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const client = new Client({ connectionString: url });
await client.connect();
await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS pgboss CASCADE;');
await client.end();
execSync("npx prisma migrate deploy", { stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
console.log("Database reset and seeded.");
