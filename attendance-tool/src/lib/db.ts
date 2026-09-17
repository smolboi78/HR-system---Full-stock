import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrls } from "../../scripts/db-url.mjs";

// The connection string is resolved here rather than left to
// env("DATABASE_URL") in the schema. On a serverless host the built
// functions run directly - no npm script, so no build wrapper - and the
// injected variable may be called POSTGRES_PRISMA_URL or STORAGE_URL
// instead. Resolving at construction keeps the app working whatever the
// host named it.
function client(): PrismaClient {
  const { pooled } = resolveDatabaseUrls();
  return pooled
    ? new PrismaClient({ datasources: { db: { url: pooled } } })
    : new PrismaClient();
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? client();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
