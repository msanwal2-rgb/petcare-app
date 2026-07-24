/**
 * Prisma client singleton.
 *
 * In dev, Next.js hot-reload re-imports modules repeatedly; without the global
 * cache we'd exhaust the connection pool. In production a single instance is
 * created per serverless instance. The connection URL (pooled) and directUrl
 * (non-pooling, for migrations) come from the Neon integration env vars.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
