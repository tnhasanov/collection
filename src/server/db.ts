import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export type Db = PrismaClient | Prisma.TransactionClient;

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __atbPrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__atbPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__atbPrisma = prisma;

export { Prisma };
