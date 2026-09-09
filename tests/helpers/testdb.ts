/**
 * Test database client. Points Prisma at an isolated `test` schema on the same
 * Neon database, so tests never touch the production `public` data. The server
 * domain functions all accept an injectable PrismaClient, so tests just pass
 * `testPrisma` — no global env juggling.
 *
 * Resetting between tests goes through a snapshot rather than re-running the
 * seeder. The seeder is ~20 round trips plus a bcrypt hash, and the database is
 * across the network — running it before every test dominated the suite's
 * wall-clock. Instead the seed runs once in global setup, gets copied into a
 * parallel `test_snapshot` schema, and each test restores from that copy in a
 * single batched transaction: one round trip, no hashing, same data.
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
const SNAPSHOT_SCHEMA = "test_snapshot";
const TEST_DATABASE_URL = withSchema(baseDbUrl(), TEST_SCHEMA);

export const testPrisma = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

/**
 * Every seeded table, in an order where inserting a row never precedes the row
 * it references. TRUNCATE ... CASCADE handles teardown regardless of order, so
 * only the insert direction matters here.
 *
 * `knowledge_chunks` is deliberately absent. It is read-only reference data
 * that global setup ingests once with a deterministic offline embedder, and
 * nothing in the app or the tests mutates it — so snapshotting and restoring it
 * on every test would be pure cost. Leaving it out of this list is what keeps
 * it intact across resets.
 */
const SEED_TABLES = [
  "users",
  "pets",
  "caretaker_profiles",
  "pricing_entries",
  "availability_days",
  "bookings",
  "reviews",
  "messages",
  "verification_tokens",
  "notifications",
  "vet_profiles",
  "vet_availability_days",
  "vet_appointments",
  "medical_records",
  "products",
  "orders",
  "order_items",
  "order_events",
  "assistant_conversations",
  "assistant_messages",
  // Admin foundations. `admin_audit_log` references users, so it must follow
  // them in this list — the INSERTs below run in order inside one transaction.
  "admin_audit_log",
  "system_settings",
  // Payments. Order matters for the same reason: plans before subscriptions,
  // payments before refunds.
  "plans",
  "subscriptions",
  "payments",
  "refunds",
  "webhook_events",
  "rate_limit_hits",
] as const;

const q = (schema: string, table: string) => `"${schema}"."${table}"`;

/**
 * Copy the freshly seeded `test` schema into `test_snapshot`. Called once from
 * global setup, after seeding.
 */
export async function captureSnapshot(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${SNAPSHOT_SCHEMA}" CASCADE`);
  await db.$executeRawUnsafe(`CREATE SCHEMA "${SNAPSHOT_SCHEMA}"`);
  for (const table of SEED_TABLES) {
    await db.$executeRawUnsafe(
      `CREATE TABLE ${q(SNAPSHOT_SCHEMA, table)} AS TABLE ${q(TEST_SCHEMA, table)}`
    );
  }
}

/**
 * Restore the seeded state. Drop-in replacement for `seedDatabase(db)` in tests.
 *
 * The whole thing is one `$transaction` array, which Prisma sends as a single
 * batched round trip — the reason this is fast.
 */
export async function resetToSnapshot(db: PrismaClient = testPrisma): Promise<void> {
  const tables = SEED_TABLES.map((t) => q(TEST_SCHEMA, t)).join(", ");
  await db.$transaction([
    db.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`),
    ...SEED_TABLES.map((t) =>
      db.$executeRawUnsafe(
        `INSERT INTO ${q(TEST_SCHEMA, t)} SELECT * FROM ${q(SNAPSHOT_SCHEMA, t)}`
      )
    ),
  ]);
}
