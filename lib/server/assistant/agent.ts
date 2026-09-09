/**
 * The agent, and the single seam the route handler talks to.
 *
 * The route calls `streamAssistant` and knows nothing about how the model is
 * driven. That indirection is deliberate: the agent construction below is the
 * one part of this feature tied to a specific AI SDK shape, so if that shape
 * changes this is the only file that changes with it.
 *
 * The tool map is per-request (it depends on whether anyone is signed in), so
 * the agent is constructed per-request too. `InferAgentUIMessage` is taken off
 * the factory's return type rather than off an instance, which gives the client
 * a stable type without a module-scope agent.
 */

import { ToolLoopAgent, createAgentUIStreamResponse, stepCountIs } from "ai";
import type { InferAgentUIMessage, UIMessage } from "ai";
import type { AssistantContext } from "./context";
import { buildInstructions, type AssistantProfile } from "./instructions";
import { buildTools, type ToolDeps } from "./tools";
import { resolveModel } from "./model";
import { getPetsByOwner } from "@/lib/server/pets";
import { isOps } from "@/lib/server/access";
import { getUserById } from "@/lib/server/users";
import { petAge } from "@/lib/utils";
import { SPECIES_LABELS } from "@/lib/utils";

/**
 * How many tool round-trips one question may take.
 *
 * Six is enough for a realistic worst case — look up the pets, find the order,
 * check a policy, then answer — and low enough that a confused loop costs a few
 * cents rather than a few dollars.
 */
const MAX_STEPS = 6;

/** Cap on one reply. Support answers are short; a long one is usually a symptom. */
const MAX_OUTPUT_TOKENS = 700;

/**
 * Load just enough about the customer to avoid a tool call for "my dog".
 * Deliberately shallow: names and ages, never health records.
 */
export async function loadProfile(
  ctx: AssistantContext,
): Promise<AssistantProfile | null> {
  if (!ctx.uid) return null;

  const [user, pets] = await Promise.all([
    getUserById(ctx.uid, ctx.db),
    getPetsByOwner(ctx.uid, ctx.db),
  ]);
  if (!user) return null;

  // Through the predicate, not the raw column: `isOps` is a legacy boolean kept
  // only until the next migration drops it, and `hasStaffRole` is what knows
  // that an admin counts as ops too.
  const ops = await isOps(ctx.uid, ctx.db);

  return {
    name: user.name,
    roles: user.roles,
    isOps: ops,
    pets: pets.map((pet) => ({
      id: pet.id,
      name: pet.name,
      species: SPECIES_LABELS[pet.species],
      age: petAge(pet, ctx.now),
      allergies: pet.allergies,
    })),
  };
}

export function createAssistantAgent(
  ctx: AssistantContext,
  profile: AssistantProfile | null,
  deps: ToolDeps = {},
) {
  const tools = buildTools(ctx, deps);

  return new ToolLoopAgent({
    // Gateway or a direct provider key — see ./model. Nothing here cares which.
    model: resolveModel(),
    instructions: buildInstructions(ctx, profile, Object.keys(tools).sort()),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
}

/** The UIMessage type the client renders, inferred from the tool map. */
export type AssistantUIMessage = InferAgentUIMessage<
  ReturnType<typeof createAssistantAgent>
>;

/** Flatten a UIMessage's text parts, for the stored `text` column. */
export function messageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export interface StreamOptions {
  deps?: ToolDeps;
  /**
   * Metadata attached to the reply and delivered to the client. This is how the
   * browser learns the conversation id the server just created — without it,
   * every turn would start a fresh thread and the history would never join up.
   */
  metadata?: Record<string, unknown>;
  /**
   * Called once the reply is complete, with the assistant's finished message.
   * Persistence hangs off this rather than off the route, so a stream that is
   * abandoned mid-flight still records what was actually said.
   */
  onFinish?: (event: { responseMessage: UIMessage; isAborted: boolean }) => Promise<void> | void;
}

/**
 * Stream a reply. The only function the route handler needs, and the only
 * place tied to a particular AI SDK shape.
 */
export function streamAssistant(
  ctx: AssistantContext,
  profile: AssistantProfile | null,
  uiMessages: UIMessage[],
  options: StreamOptions = {},
): Promise<Response> {
  const agent = createAssistantAgent(ctx, profile, options.deps ?? {});
  return createAgentUIStreamResponse({
    agent,
    uiMessages,
    messageMetadata: () => options.metadata,
    onFinish: async ({ responseMessage, isAborted }) => {
      await options.onFinish?.({ responseMessage: responseMessage as UIMessage, isAborted });
    },
  });
}
