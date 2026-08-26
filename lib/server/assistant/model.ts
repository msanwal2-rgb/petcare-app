/**
 * Which model the assistant talks to, and through what.
 *
 * Three routes, one seam:
 *
 * - **OpenRouter** (`OPENROUTER_API_KEY`) — one key reaching every provider,
 *   including the embeddings the retrieval corpus needs. Highest precedence
 *   because setting it is the most explicit choice of the three.
 * - **A direct Anthropic key** (`ANTHROPIC_API_KEY`) — chat only. Anthropic
 *   publishes no embedding model, so the ingest still needs another source.
 * - **Vercel AI Gateway** (the default, and what production should use).
 *   Plain "provider/model" strings, spend limits in the Vercel dashboard.
 *   Uses AI_GATEWAY_API_KEY, or Vercel's OIDC token on a deployment.
 *
 * Precedence runs explicit-to-implicit. VERCEL_OIDC_TOKEN turns up in
 * .env.local unbidden, so it must not outrank a key somebody deliberately set.
 *
 * Nothing else in the assistant imports a provider. agent.ts asks for a model
 * and gets one; embed.ts asks for an embedder. Adding a fourth route is a
 * change to this file and nowhere else.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, LanguageModel } from "ai";

/**
 * Sonnet 5 — $2 per million input tokens, $10 per million output.
 *
 * Chosen over Opus for a support bot because the work is retrieval and
 * summary over tool output rather than hard reasoning, and the difference
 * shows up in the bill rather than in the answers. `claude-opus-5` ($5/$25) is
 * the upgrade if answers ever justify it; `claude-haiku-4-5` ($1/$5) is the
 * downgrade if spend surprises us. Both are one env var away.
 *
 * Note the ids carry no date suffix — `claude-haiku-4-5`, never
 * `claude-haiku-4-5-20251001`. A suffixed id is a stale form that no longer
 * resolves.
 */
export const DEFAULT_GATEWAY_MODEL = "anthropic/claude-sonnet-5";

/**
 * The same model, named the way Anthropic's own API names it: the gateway
 * prefixes with the provider, the direct API does not.
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export type ModelRoute = "openrouter" | "anthropic" | "gateway";

export function modelRoute(): ModelRoute {
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "gateway";
}

/**
 * OpenRouter names models the way the gateway does: provider/model.
 *
 * Defaults to a **free** model, because the point of the OpenRouter route is to
 * run this thing without a bill. Nemotron Super handles what the assistant
 * actually asks of a model — a 25-tool surface and a multi-step loop — and was
 * verified end to end against real orders and the corpus.
 *
 * What you give up is reliability, not capability. Free endpoints are shared
 * and contended: expect the occasional 502 ("Service temporarily overloaded")
 * and 429, more so on the larger free variants. `nemotron-3.5-lightning:free`
 * is the steadier fallback. Anything with a real budget behind it — the paid
 * `nvidia/nemotron-3-super-120b-a12b`, or `anthropic/claude-sonnet-4.5` — is
 * one env var away via ASSISTANT_OPENROUTER_MODEL.
 *
 * Note that free tiers are throttled hard when the account carries no credits;
 * some (`z-ai/glm-5.2:free`) return 429 unconditionally in that state.
 */
export const DEFAULT_OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

/**
 * OpenRouter speaks the OpenAI wire format, so the generic compatible provider
 * covers it — and covers `/v1/embeddings` too, which is what makes it the only
 * single credential that satisfies both halves of this feature.
 *
 * The referer and title headers are OpenRouter's convention for attributing
 * traffic; they are optional and harmless.
 */
function openrouter() {
  return createOpenAICompatible({
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: {
      "HTTP-Referer": process.env.NEXTAUTH_URL ?? "https://petcare-app-drab.vercel.app",
      "X-Title": "Leash support assistant",
    },
  });
}

/** Is there any credential at all? The route handler fails closed without one. */
export function hasModelCredential(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN,
  );
}

/** A label for logs and for the stored `modelId` column. */
export function modelId(): string {
  switch (modelRoute()) {
    case "openrouter":
      return `openrouter:${process.env.ASSISTANT_OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL}`;
    case "anthropic":
      return `anthropic:${process.env.ASSISTANT_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL}`;
    default:
      return process.env.ASSISTANT_MODEL ?? DEFAULT_GATEWAY_MODEL;
  }
}

export function resolveModel(): LanguageModel {
  switch (modelRoute()) {
    case "openrouter":
      return openrouter().chatModel(
        process.env.ASSISTANT_OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
      );
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
        process.env.ASSISTANT_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL,
      );
    default:
      // A bare string resolves through the gateway, which is the AI SDK's
      // default global provider — no provider package involved.
      return process.env.ASSISTANT_MODEL ?? DEFAULT_GATEWAY_MODEL;
  }
}

/**
 * The embedding model for `npm run kb:ingest`.
 *
 * Returns null when the active route cannot embed — Anthropic publishes no
 * embedding model, so an ANTHROPIC_API_KEY alone gets you a working assistant
 * with an un-ingestable corpus. Better to say so than to fail at the first
 * batch with a 404.
 */
export function resolveEmbeddingModel(): EmbeddingModel | string | null {
  const model = process.env.ASSISTANT_EMBED_MODEL ?? "openai/text-embedding-3-small";
  switch (modelRoute()) {
    case "openrouter":
      return openrouter().textEmbeddingModel(model);
    case "anthropic":
      return null;
    default:
      return model;
  }
}
