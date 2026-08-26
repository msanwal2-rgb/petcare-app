/**
 * Vitest global setup: provision the isolated `test` schema on the Neon
 * database (production data lives in `public` and is never touched), push the
 * Prisma schema into it, seed it once, and snapshot the result.
 *
 * Seeding here rather than per-test is what makes the suite quick: tests call
 * `resetToSnapshot()`, which restores this exact state in one round trip.
 *
 * The `test` schema is shared, so two suite runs against the same database at
 * once will corrupt each other. Run one at a time.
 */

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "@/lib/server/seed";
import { ingestKnowledge } from "@/lib/server/assistant/ingest";
import { hashEmbed } from "@/lib/server/assistant/embed";
import {
  baseDbUrl,
  captureSnapshot,
  withSchema,
  TEST_SCHEMA,
} from "./testdb";

export default async function setup() {
  const base = baseDbUrl();

  // Create the schema first (a client bound to a non-existent schema can't run
  // DDL against it), using an admin client on the default search path.
  const admin = new PrismaClient({ datasources: { db: { url: base } } });
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
    // pgvector, for the assistant's knowledge_chunks table. Extensions are
    // database-scoped, so this is the same install the migration makes rather
    // than a second one — `IF NOT EXISTS` makes running both harmless. It has
    // to happen before `db push`, which cannot create a vector column without
    // the type already existing.
    await admin.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`,
    );
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

  // Seed once, then snapshot it for the per-test restore.
  const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
  try {
    await seedDatabase(db);

    // The assistant's retrieval corpus, embedded with the deterministic hash
    // embedder — no network, no spend, and identical vectors every run, so
    // retrieval assertions are stable. Ingested before the snapshot but left
    // out of SEED_TABLES: it is reference data that no test mutates, so it
    // survives every resetToSnapshot untouched.
    await ingestKnowledge(
      { embed: hashEmbed(), schema: TEST_SCHEMA, force: true },
      db,
    );

    await captureSnapshot(db);
  } finally {
    await db.$disconnect();
  }
}
