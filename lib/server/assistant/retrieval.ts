/**
 * Hybrid retrieval over the assistant's knowledge corpus.
 *
 * Dense vectors alone are a poor fit for this corpus. It is a few dozen short
 * prose chunks, and embeddings of short policy snippets cluster tightly — "can
 * I cancel my booking" and "can I cancel my order" land within a few
 * hundredths of each other, and the wrong one wins often enough to matter. So
 * every query runs twice: once as cosine similarity over pgvector, once as
 * Postgres full-text ranking, and the two rankings are fused with Reciprocal
 * Rank Fusion. Lexical retrieval is what tells those two questions apart,
 * because the discriminating word is right there in both.
 *
 * Anything that neither leg is confident about is dropped rather than returned
 * as a weak nearest neighbour, so an empty result is a normal outcome. The
 * system prompt knows to say "I don't have a policy on that" rather than
 * improvise from a bad match.
 *
 * ── The one rule for raw SQL here ──────────────────────────────────
 * Prisma's `?schema=` parameter does NOT move `search_path` — it stays
 * `"$user", public`. The model API schema-qualifies internally, but raw SQL
 * does not, so an unqualified `knowledge_chunks` in a test run would silently
 * read and write the *production* table. Every statement below takes its schema
 * explicitly. The schema name comes from env or a test constant and is never
 * user input; the query text and the vector are bound parameters.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { gatewayEmbed, toVectorLiteral, type EmbedFn } from "./embed";
import type { CorpusSource } from "./corpus";

export interface KnowledgeHit {
  sourceKey: string;
  source: CorpusSource;
  title: string;
  href: string;
  content: string;
  /** Cosine similarity, 0–1. Null when only the lexical leg matched. */
  similarity: number | null;
  /** Fused Reciprocal Rank Fusion score. Ordering key; not meaningful alone. */
  score: number;
}

export interface SearchOptions {
  /** How many hits to return. */
  topK?: number;
  /**
   * Dense-similarity floor. A hit below this is kept only if the lexical leg
   * also found it, so this only ever rejects dense-only matches.
   *
   * 0.30 is calibrated against real embeddings, not the hash stand-in. A model
   * like text-embedding-3-small never returns a genuinely low score — pure
   * gibberish still scores ~0.15 against an arbitrary chunk, because every
   * piece of English text shares some direction with every other. Measured on
   * this corpus: real questions land at 0.36–0.77, gibberish at 0.15. A floor
   * of 0.15 (which looks generous against a bag-of-words embedder, where
   * unrelated text really does score near zero) lets that gibberish through.
   */
  minSimilarity?: number;
  /** Injected in tests so retrieval can be asserted offline. */
  embed?: EmbedFn;
  /** Which Postgres schema the table lives in. See the header note. */
  schema?: string;
}

/** Candidates pulled from each leg before fusion. */
const CANDIDATES = 20;

/**
 * RRF's damping constant. 60 is the value from the original paper and is not
 * sensitive — it exists to stop rank 1 dominating rank 2 outright.
 */
const RRF_K = 60;

interface DenseRow {
  sourceKey: string;
  source: string;
  title: string;
  href: string;
  content: string;
  similarity: number;
}

interface LexicalRow {
  sourceKey: string;
  source: string;
  title: string;
  href: string;
  content: string;
  rank: number;
}

function tableFor(schema: string): string {
  // Defensive: the schema is ours, never a caller's, but an identifier that
  // reaches raw SQL should still be shown to be safe at a glance.
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new Error(`Refusing to query an unexpected schema name: ${schema}`);
  }
  return `"${schema}"."knowledge_chunks"`;
}

export function defaultSchema(): string {
  return process.env.ASSISTANT_DB_SCHEMA ?? "public";
}

/**
 * Search the corpus. Returns [] when nothing clears the bar — a legitimate
 * answer, not an error.
 */
export async function searchKnowledge(
  query: string,
  options: SearchOptions = {},
  db: PrismaClient = defaultPrisma,
): Promise<KnowledgeHit[]> {
  const {
    topK = 6,
    minSimilarity = 0.3,
    embed = gatewayEmbed(),
    schema = defaultSchema(),
  } = options;

  const trimmed = query.trim();
  if (!trimmed) return [];

  const table = tableFor(schema);

  // Dense leg. Runs first because it is the one that can fail (a network call
  // to the embedding model); if it does, we still want the lexical answer.
  let dense: DenseRow[] = [];
  try {
    const [vector] = await embed([trimmed]);
    if (vector) {
      dense = await db.$queryRawUnsafe<DenseRow[]>(
        `SELECT "sourceKey", source, title, href, content,
                1 - (embedding <=> $1::vector) AS similarity
           FROM ${table}
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector
          LIMIT $2`,
        toVectorLiteral(vector),
        CANDIDATES,
      );
    }
  } catch (error) {
    // Retrieval degrading to lexical-only is much better than the whole answer
    // failing, so this is logged and swallowed rather than thrown.
    console.error("[assistant] dense retrieval failed, falling back to lexical", error);
  }

  // Lexical leg.
  //
  // The obvious choice, `websearch_to_tsquery`, is wrong here: it ANDs every
  // term, so "how do I return something I bought" demands a chunk containing
  // return AND something AND bought, and matches nothing at all. Real support
  // questions are long and mostly filler; requiring every content word is a
  // guarantee of zero results.
  //
  // Instead the query text is run through `to_tsvector` — which stems it and
  // drops stop words using the same dictionary the indexed column uses — and
  // the surviving lexemes are ORed. Matching more of them then ranks higher
  // naturally via ts_rank_cd, so precision comes from the ranking rather than
  // from the filter. Going through to_tsvector rather than string-splitting is
  // also what keeps this safe: the text is parsed by Postgres, never
  // concatenated into the query.
  //
  // A query with no lexemes at all (punctuation, gibberish stripped to
  // nothing) yields NULL rather than an empty tsquery, which would be a syntax
  // error, and the WHERE drops it.
  const lexical = await db.$queryRawUnsafe<LexicalRow[]>(
    `WITH q AS (
       SELECT NULLIF(
         array_to_string(tsvector_to_array(to_tsvector('english', $1)), ' | '),
         ''
       )::tsquery AS tsq
     )
     SELECT k."sourceKey", k.source, k.title, k.href, k.content,
            ts_rank_cd(to_tsvector('english', k.title || ' ' || k.content), q.tsq) AS rank
       FROM ${table} k, q
      WHERE q.tsq IS NOT NULL
        AND to_tsvector('english', k.title || ' ' || k.content) @@ q.tsq
      ORDER BY rank DESC
      LIMIT $2`,
    trimmed,
    CANDIDATES,
  );

  return fuse(dense, lexical, { topK, minSimilarity });
}

/**
 * Reciprocal Rank Fusion: score by position in each list rather than by raw
 * score, because a cosine similarity and a ts_rank are not on the same scale
 * and normalising them against each other would be inventing a relationship.
 */
function fuse(
  dense: DenseRow[],
  lexical: LexicalRow[],
  { topK, minSimilarity }: { topK: number; minSimilarity: number },
): KnowledgeHit[] {
  const merged = new Map<string, KnowledgeHit>();
  const lexicalKeys = new Set(lexical.map((row) => row.sourceKey));

  const upsert = (
    row: DenseRow | LexicalRow,
    rank: number,
    similarity: number | null,
  ) => {
    const existing = merged.get(row.sourceKey);
    const contribution = 1 / (RRF_K + rank);
    if (existing) {
      existing.score += contribution;
      if (similarity !== null) existing.similarity = similarity;
      return;
    }
    merged.set(row.sourceKey, {
      sourceKey: row.sourceKey,
      source: row.source as CorpusSource,
      title: row.title,
      href: row.href,
      content: row.content,
      similarity,
      score: contribution,
    });
  };

  dense.forEach((row, index) => upsert(row, index + 1, row.similarity));
  lexical.forEach((row, index) => upsert(row, index + 1, null));

  return [...merged.values()]
    .filter((hit) => {
      // A weak dense match is only trustworthy if the lexical leg agrees.
      if (hit.similarity === null) return true;
      return hit.similarity >= minSimilarity || lexicalKeys.has(hit.sourceKey);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
