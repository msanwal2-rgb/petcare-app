/**
 * Test database client. Points Prisma at an isolated `test` schema on the same
 * Neon database, so tests never touch the production `public` data. The server
 * domain functions all accept an injectable PrismaClient, so tests just pass
 * `testPrisma` — no global env juggling.
 */

import { PrismaClient } from "@prisma/client";

export function withSchema(base: string, schema: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}schema=${schema}`;
}

export function baseDbUrl(): string {
  const url =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;
  if (!url) throw new Error("No database URL found in env for tests");
  return url;
}

export const TEST_SCHEMA = "test";
export const TEST_DATABASE_URL = withSchema(baseDbUrl(), TEST_SCHEMA);

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});
