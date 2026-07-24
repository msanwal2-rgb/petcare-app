/**
 * Vitest global setup: provision the isolated `test` schema on the Neon
 * database (production data lives in `public` and is never touched), then push
 * the Prisma schema into it. Runs once before the whole suite.
 */

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { baseDbUrl, withSchema, TEST_SCHEMA } from "./testdb";

export default async function setup() {
  const base = baseDbUrl();

  // Create the schema first (a client bound to a non-existent schema can't run
  // DDL against it), using an admin client on the default search path.
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
  } finally {
    await admin.$disconnect();
  }

  // Push the current Prisma schema into the test schema. No shadow DB needed.
  const testUrl = withSchema(base, TEST_SCHEMA);
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: {
      ...process.env,
      POSTGRES_PRISMA_URL: testUrl,
      POSTGRES_URL_NON_POOLING: testUrl,
    },
  });
}
