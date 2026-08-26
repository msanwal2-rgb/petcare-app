/**
 * Embeddings for the assistant's retrieval corpus.
 *
 * Two implementations behind one type:
 *
 * - `gatewayEmbed` calls a real embedding model through the Vercel AI Gateway.
 *   Used by `npm run kb:ingest` and by nothing else — embedding happens at
 *   ingest time, never on a request.
 * - `hashEmbed` is a deterministic, offline, free stand-in. The test suite uses
 *   it so retrieval can be asserted against real behaviour without a network
 *   call or a cent of spend. It is a hashed bag of words, so cosine similarity
 *   over it genuinely tracks lexical overlap — the assertions mean something.
 *
 * Injecting `EmbedFn` rather than importing a model directly is what makes that
 * substitution possible, and is the same seam `lib/server/payments.ts` uses for
 * the payment provider.
 */

/** Embeds a batch of texts, returning one vector per input, in order. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/**
 * Must match the `vector(1536)` column in the schema. Changing this means a
 * migration that alters the column and a full `kb:ingest --force`.
 */
export const EMBED_DIM = 1536;

export const DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small";

/**
 * pgvector takes its input as a bracketed literal, not as a bound array — there
 * is no Postgres array type that casts straight to `vector`. Always pair this
 * with an explicit `$n::vector` in the SQL.
 */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** L2-normalise in place-ish, so cosine and inner product agree. */
function normalise(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum);
  if (length === 0) return vector;
  return vector.map((value) => value / length);
}

/**
 * The real embedder, routed through ./model so it follows whichever credential
 * is configured — OpenRouter, or the gateway.
 *
 * Both `ai` and the model seam are imported lazily, so this module (and the
 * corpus and retrieval code that import it) stays loadable in contexts that
 * never embed anything: a test run with no key set, or the request path, which
 * only ever reads vectors that ingest already wrote.
 */
export function gatewayEmbed(): EmbedFn {
  return async (texts) => {
    if (texts.length === 0) return [];
    const [{ embedMany }, { resolveEmbeddingModel, modelRoute }] = await Promise.all([
      import("ai"),
      import("./model"),
    ]);
    const model = resolveEmbeddingModel();
    if (!model) {
      throw new Error(
        `The ${modelRoute()} route has no embedding model. Anthropic does not ` +
          "publish one — set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY to ingest " +
          "the corpus, or pass --offline for the deterministic hash embedder.",
      );
    }
    const { embeddings } = await embedMany({ model, values: texts });
    return embeddings as number[][];
  };
}

/**
 * Stop words, dropped before hashing.
 *
 * Without this the embedder is dominated by the words every sentence shares:
 * "how do I return something I bought" scored closest to the account-deletion
 * FAQ, because both are mostly function words. A real embedding model learns
 * to discount these; a bag of words has to be told.
 */
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "did",
  "do", "does", "for", "from", "get", "had", "has", "have", "how", "i", "if",
  "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "out", "so",
  "than", "that", "the", "their", "them", "then", "there", "these", "they",
  "this", "to", "up", "was", "we", "were", "what", "when", "where", "which",
  "who", "why", "will", "with", "would", "you", "your",
]);

/** FNV-1a. Small, fast, and stable across runs and machines — which is the point. */
function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * A deterministic offline embedder for tests and dry runs.
 *
 * Bag of words hashed into `dim` buckets, then L2-normalised. Two texts that
 * share vocabulary land close together; two that don't, don't. That is enough
 * for retrieval tests to assert real ranking rather than smoke, and it costs
 * nothing and never varies.
 */
export function hashEmbed(dim: number = EMBED_DIM): EmbedFn {
  return async (texts) =>
    texts.map((text) => {
      const vector = new Array<number>(dim).fill(0);
      const tokens = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token && !STOP_WORDS.has(token));
      for (const token of tokens) {
        vector[hashToken(token) % dim] += 1;
        // Also hash the stem, so "cancelling" and "cancel" overlap.
        const stem = token.replace(/(ing|ed|es|s)$/, "");
        if (stem !== token && stem.length > 2) vector[hashToken(stem) % dim] += 0.5;
      }
      return normalise(vector);
    });
}
