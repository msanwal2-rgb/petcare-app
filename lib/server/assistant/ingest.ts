/**
 * Builds the retrieval corpus into the database.
 *
 * Idempotent by content hash: re-running with nothing changed makes zero
 * embedding calls and zero writes. That is what makes it safe to run from the
 * test global setup on every `npm test`, and cheap to run on every deploy.
 *
 * The metadata write goes through the normal Prisma model API — which handles
 * schema qualification correctly. Only the embedding itself needs raw SQL,
 * because Prisma omits `Unsupported` columns from the generated client, and
 * that one statement is schema-qualified explicitly (see retrieval.ts's header
 * for why that matters).
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { createHash } from "node:crypto";
import { buildCorpus, embeddableText, type CorpusItem } from "./corpus";
import { gatewayEmbed, toVectorLiteral, type EmbedFn } from "./embed";
import { defaultSchema } from "./retrieval";
import { genId, nowIso } from "@/lib/server/ids";

export interface IngestOptions {
  embed?: EmbedFn;
  schema?: string;
  /** Re-embed everything, even chunks whose content is unchanged. */
  force?: boolean;
  /** Build and report without writing anything. */
  dryRun?: boolean;
  log?: (message: string) => void;
  /** Override the corpus. Tests use this to assert deletion behaviour. */
  corpus?: CorpusItem[];
}

export interface IngestReport {
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
  embedded: number;
  /** Rough token count of everything sent to the embedding model. */
  tokensEmbedded: number;
}

/** How many texts to send per embedding request. */
const BATCH = 64;

function hashContent(item: CorpusItem): string {
  return createHash("sha256").update(embeddableText(item)).digest("hex");
}

/** Good enough for a spend estimate and the `tokens` column; not a tokenizer. */
function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function ingestKnowledge(
  options: IngestOptions = {},
  db: PrismaClient = defaultPrisma,
): Promise<IngestReport> {
  const {
    embed = gatewayEmbed(),
    schema = defaultSchema(),
    force = false,
    dryRun = false,
    log = () => {},
    corpus = buildCorpus(),
  } = options;

  const report: IngestReport = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    embedded: 0,
    tokensEmbedded: 0,
  };

  const hashes = new Map(corpus.map((item) => [item.sourceKey, hashContent(item)]));

  // Existing rows, and whether they already carry an embedding. The embedding
  // column is invisible to the client, so its presence is asked for in SQL.
  const existing = await db.knowledgeChunk.findMany({
    select: { sourceKey: true, contentHash: true },
  });
  const existingByKey = new Map(existing.map((row) => [row.sourceKey, row]));

  const embedded = await db.$queryRawUnsafe<{ sourceKey: string }[]>(
    `SELECT "sourceKey" FROM "${schema}"."knowledge_chunks" WHERE embedding IS NOT NULL`,
  );
  const hasEmbedding = new Set(embedded.map((row) => row.sourceKey));

  const needsEmbedding: CorpusItem[] = [];
  for (const item of corpus) {
    const prior = existingByKey.get(item.sourceKey);
    const unchanged =
      prior?.contentHash === hashes.get(item.sourceKey) &&
      hasEmbedding.has(item.sourceKey);
    if (unchanged && !force) {
      report.skipped++;
      continue;
    }
    needsEmbedding.push(item);
  }

  const stale = existing
    .map((row) => row.sourceKey)
    .filter((key) => !hashes.has(key));

  if (dryRun) {
    report.embedded = needsEmbedding.length;
    report.tokensEmbedded = needsEmbedding.reduce(
      (sum, item) => sum + approximateTokens(embeddableText(item)),
      0,
    );
    report.deleted = stale.length;
    for (const item of needsEmbedding) log(`  would embed  ${item.sourceKey}`);
    for (const key of stale) log(`  would delete ${key}`);
    return report;
  }

  // Metadata first, so a row exists to attach the vector to.
  for (const item of corpus) {
    const prior = existingByKey.get(item.sourceKey);
    const hash = hashes.get(item.sourceKey)!;
    const now = nowIso();
    const unchanged = prior?.contentHash === hash && hasEmbedding.has(item.sourceKey);
    if (unchanged && !force) continue;

    await db.knowledgeChunk.upsert({
      where: { sourceKey: item.sourceKey },
      create: {
        id: genId("kb"),
        sourceKey: item.sourceKey,
        source: item.source,
        title: item.title,
        href: item.href,
        species: item.species,
        content: item.content,
        contentHash: hash,
        tokens: approximateTokens(embeddableText(item)),
        createdAt: now,
        updatedAt: now,
      },
      update: {
        source: item.source,
        title: item.title,
        href: item.href,
        species: item.species,
        content: item.content,
        contentHash: hash,
        tokens: approximateTokens(embeddableText(item)),
        updatedAt: now,
      },
    });

    if (prior) report.updated++;
    else report.inserted++;
  }

  // Then the vectors, in batches.
  for (let start = 0; start < needsEmbedding.length; start += BATCH) {
    const batch = needsEmbedding.slice(start, start + BATCH);
    const texts = batch.map(embeddableText);
    const vectors = await embed(texts);
    if (vectors.length !== batch.length) {
      throw new Error(
        `Embedder returned ${vectors.length} vectors for ${batch.length} inputs`,
      );
    }
    for (let i = 0; i < batch.length; i++) {
      await db.$executeRawUnsafe(
        `UPDATE "${schema}"."knowledge_chunks" SET embedding = $1::vector WHERE "sourceKey" = $2`,
        toVectorLiteral(vectors[i]),
        batch[i].sourceKey,
      );
    }
    report.embedded += batch.length;
    report.tokensEmbedded += texts.reduce((sum, t) => sum + approximateTokens(t), 0);
    log(`  embedded ${Math.min(start + BATCH, needsEmbedding.length)}/${needsEmbedding.length}`);
  }

  // Finally, drop anything the corpus no longer produces, so removing a policy
  // removes its chunk rather than leaving it to be retrieved forever.
  if (stale.length > 0) {
    const { count } = await db.knowledgeChunk.deleteMany({
      where: { sourceKey: { in: stale } },
    });
    report.deleted = count;
  }

  return report;
}
