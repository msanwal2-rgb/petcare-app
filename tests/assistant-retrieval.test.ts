/**
 * Retrieval over the assistant's knowledge corpus.
 *
 * Every assertion here runs against the deterministic hash embedder, so the
 * suite makes no network call and costs nothing, and the same query ranks the
 * same way on every machine. That is the point: with a real embedding model
 * these would be smoke tests, because you could not assert an ordering without
 * pinning a model version.
 *
 * The corpus is ingested once in global setup and deliberately left out of
 * SEED_TABLES, so it survives resetToSnapshot between tests.
 */

import { afterAll, describe, expect, it } from "vitest";
import { testPrisma as db, TEST_SCHEMA } from "./helpers/testdb";
import { searchKnowledge } from "@/lib/server/assistant/retrieval";
import { ingestKnowledge } from "@/lib/server/assistant/ingest";
import { buildCorpus } from "@/lib/server/assistant/corpus";
import { hashEmbed } from "@/lib/server/assistant/embed";

const embed = hashEmbed();
const search = (query: string, topK = 6) =>
  searchKnowledge(query, { embed, schema: TEST_SCHEMA, topK }, db);

afterAll(async () => {
  await db.$disconnect();
});

describe("knowledge corpus", () => {
  it("builds stable, unique source keys", () => {
    const corpus = buildCorpus();
    const keys = corpus.map((item) => item.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(corpus.length).toBeGreaterThan(20);
  });

  it("covers every content source", () => {
    const sources = new Set(buildCorpus().map((item) => item.source));
    expect(sources).toEqual(new Set(["policy", "faq", "guide", "vaccine"]));
  });

  it("excludes emergency red flags — those belong in the system prompt", () => {
    // Retrieval is allowed to miss. An emergency answer is not, so red flags
    // are inlined into the instructions instead of being searched for.
    const corpus = buildCorpus();
    const mentionsRedFlag = corpus.some((item) =>
      item.content.includes("Cats only mouth-breathe when they are in real trouble"),
    );
    expect(mentionsRedFlag).toBe(false);
  });
});

describe("searchKnowledge", () => {
  it("finds the returns policy", async () => {
    const hits = await search("how do I return something I bought");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.sourceKey)).toContain("policy:returns");
  });

  it("finds shipping cost rules", async () => {
    const hits = await search("why was I charged for shipping");
    expect(hits.map((h) => h.sourceKey)).toContain("faq:why-was-i-charged-shipping");
  });

  it("separates booking cancellation from order cancellation", async () => {
    // The exact confusion hybrid retrieval exists to fix: two chunks that are
    // near-identical in embedding space and distinguished by one word.
    const hits = await search("can I cancel my dog walk booking");
    const keys = hits.map((h) => h.sourceKey);
    const booking = keys.indexOf("policy:booking-cancellation");
    const order = keys.indexOf("policy:order-cancellation");

    expect(booking).toBeGreaterThanOrEqual(0);
    if (order >= 0) expect(booking).toBeLessThan(order);
  });

  it("finds the vaccination schedule for a puppy", async () => {
    const hits = await search("when does my puppy need its rabies shot", 5);
    expect(hits.some((h) => h.sourceKey.startsWith("vaccine:dog"))).toBe(true);
  });

  it("explains why a prescription product is locked", async () => {
    const hits = await search("why can't I add this prescription food to my cart");
    expect(hits.map((h) => h.sourceKey)).toContain("policy:prescriptions");
  });

  it("returns nothing for gibberish rather than a weak nearest neighbour", async () => {
    const hits = await search("zxqv wrrbl ttgh mmphlk");
    expect(hits).toEqual([]);
  });

  it("returns nothing for an empty query", async () => {
    expect(await search("   ")).toEqual([]);
  });

  it("respects topK", async () => {
    const hits = await search("order", 3);
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("carries a citable href on every hit", async () => {
    const hits = await search("what is your returns policy");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) expect(hit.href).toMatch(/^\//);
  });

  it("refuses a schema name that isn't a plain identifier", async () => {
    await expect(
      searchKnowledge("returns", { embed, schema: 'test"; DROP TABLE users; --' }, db),
    ).rejects.toThrow(/unexpected schema name/);
  });
});

describe("ingestKnowledge", () => {
  it("is a no-op when the corpus is unchanged", async () => {
    const report = await ingestKnowledge(
      { embed, schema: TEST_SCHEMA },
      db,
    );
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.embedded).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.skipped).toBeGreaterThan(0);
  });

  it("reports what a dry run would do without writing", async () => {
    const corpus = buildCorpus();
    const report = await ingestKnowledge(
      {
        embed,
        schema: TEST_SCHEMA,
        dryRun: true,
        force: true,
        corpus,
      },
      db,
    );
    expect(report.embedded).toBe(corpus.length);
    expect(report.inserted).toBe(0);
    expect(report.updated).toBe(0);
  });
});
