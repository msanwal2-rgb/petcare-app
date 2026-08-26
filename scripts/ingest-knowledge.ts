/**
 * Embeds the support content into the assistant's retrieval corpus.
 *
 * Why a script rather than something that runs on demand: embedding is the one
 * part of retrieval that costs money and takes seconds, and the corpus only
 * changes when someone edits lib/content/*. Doing it at build time means a
 * customer's question never waits on an embedding call, and a content typo
 * costs a re-run rather than a per-request penalty.
 *
 * Safe to run repeatedly. Each chunk is hashed, and a chunk whose text hasn't
 * changed is skipped without an API call — so the second run of an unchanged
 * corpus makes no requests and no writes at all.
 *
 * Run:  npm run kb:ingest
 *       npm run kb:ingest -- --dry-run     # show what would change, touch nothing
 *       npm run kb:ingest -- --force       # re-embed everything
 *       npm run kb:ingest -- --schema=test # target the test schema
 */

import { ingestKnowledge } from "../lib/server/assistant/ingest";
import { defaultSchema } from "../lib/server/assistant/retrieval";
import { hashEmbed } from "../lib/server/assistant/embed";
import { modelRoute, resolveEmbeddingModel } from "../lib/server/assistant/model";
import { prisma } from "../lib/db/prisma";

/** Rough public price of text-embedding-3-small, for the spend line. */
const USD_PER_MILLION_TOKENS = 0.02;

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const [, value] = hit.split("=");
  return value ?? "";
}

async function main() {
  const dryRun = flag("dry-run") !== undefined;
  const force = flag("force") !== undefined;
  const offline = flag("offline") !== undefined;
  const schema = flag("schema") || defaultSchema();

  if (!offline && !dryRun && !resolveEmbeddingModel()) {
    console.error(
      `The "${modelRoute()}" route has no embedding model.\n` +
        "Set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY in .env.local, or pass\n" +
        "--offline to use the deterministic hash embedder instead.",
    );
    process.exit(1);
  }

  console.log(`Ingesting knowledge into schema "${schema}"`);
  console.log(
    `  embedder: ${
      offline
        ? "hash (offline, deterministic)"
        : `${process.env.ASSISTANT_EMBED_MODEL ?? "openai/text-embedding-3-small"} via ${modelRoute()}`
    }`,
  );
  if (dryRun) console.log("  dry run — nothing will be written\n");
  else console.log("");

  const report = await ingestKnowledge(
    {
      schema,
      force,
      dryRun,
      log: (message) => console.log(message),
      ...(offline ? { embed: hashEmbed() } : {}),
    },
    prisma,
  );

  const spend = (report.tokensEmbedded / 1_000_000) * USD_PER_MILLION_TOKENS;

  console.log(
    `\n  inserted ${report.inserted}` +
      `   updated ${report.updated}` +
      `   skipped ${report.skipped}` +
      `   deleted ${report.deleted}`,
  );
  console.log(
    `  embedded ${report.embedded} chunks, ~${report.tokensEmbedded.toLocaleString()} tokens` +
      (offline || report.embedded === 0 ? "" : ` (~$${spend.toFixed(4)})`),
  );

  if (!dryRun && report.embedded === 0 && report.deleted === 0) {
    console.log("\n  Nothing to do — the corpus is already current.");
  }
}

main()
  .catch((error) => {
    console.error("\nIngest failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
