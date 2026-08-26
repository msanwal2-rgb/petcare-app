/**
 * POST /api/assistant/chat — the support assistant.
 *
 * Thin, like every other handler here: establish who is calling, check the
 * limits, hand off to the domain layer. The difference from the rest of
 * app/api is that this one streams, so it returns a bare Response rather than
 * going through `ok()`.
 *
 * Two things this route does that no other route needs to:
 *
 * - **It is deliberately reachable while signed out.** proxy.ts does not match
 *   /api/*, so there is no middleware doing this for us; `requireUser` is
 *   called for its answer rather than for its 401, and a null uid produces a
 *   smaller tool set rather than a refusal. Every account tool re-checks the
 *   session itself.
 * - **It fails closed.** With no gateway credential configured it refuses
 *   rather than surfacing a provider error to a customer, matching what
 *   /api/cron/advance-orders does with CRON_SECRET.
 */

import type { UIMessage } from "ai";
import { auth } from "@/auth";
import { error, parseBody } from "@/lib/server/http";
import { assistantChatSchema } from "@/lib/validation/schemas";
import { buildContext } from "@/lib/server/assistant/context";
import { checkRateLimit } from "@/lib/server/assistant/rate-limit";
import {
  appendMessages,
  ensureConversation,
} from "@/lib/server/assistant/conversations";
import {
  loadProfile,
  messageText,
  streamAssistant,
} from "@/lib/server/assistant/agent";
import { hasModelCredential, modelId } from "@/lib/server/assistant/model";

/**
 * A tool-looping agent is not a fast handler. Six steps of model call plus
 * database round trip can legitimately take half a minute.
 */
export const maxDuration = 30;

/** Is the assistant switched on, and can it actually reach a model? */
function readiness(): { ready: true } | { ready: false; reason: string } {
  if (process.env.ASSISTANT_ENABLED === "false") {
    return { ready: false, reason: "The assistant is currently switched off." };
  }
  if (!hasModelCredential()) {
    return {
      ready: false,
      reason: "The assistant isn't configured on this deployment.",
    };
  }
  return { ready: true };
}

export async function POST(request: Request) {
  const state = readiness();
  if (!state.ready) return error(state.reason, 503);

  const parsed = await parseBody(request, assistantChatSchema);
  if ("response" in parsed) return parsed.response;
  const { messages, conversationId, path } = parsed.data;

  // Not requireUser(): signing out is not an error here, it is a smaller
  // capability set. The uid still comes from the real session and nowhere else.
  const session = await auth();
  const uid = session?.user?.id ?? null;

  const ctx = buildContext(request, uid, { path });

  const limit = await checkRateLimit(ctx);
  if (!limit.allowed) {
    return error(limit.message ?? "Too many messages. Try again shortly.", 429, {
      window: limit.window,
    });
  }

  const conversation = await ensureConversation(ctx, conversationId);

  // Only the newest turn is persisted from the request; everything before it is
  // already stored from earlier turns, and trusting the client's copy of the
  // history would let it rewrite what it had previously been told.
  const latest = messages[messages.length - 1] as UIMessage;
  if (latest?.role === "user") {
    await appendMessages(ctx, conversation.id, [
      { role: "user", parts: latest.parts, text: messageText(latest) },
    ]);
  }

  const profile = await loadProfile(ctx);

  const response = await streamAssistant(ctx, profile, messages as UIMessage[], {
    // The browser reads this off the reply to continue the same thread next
    // turn. The header below says the same thing for anything driving this
    // endpoint directly, like curl.
    metadata: { conversationId: conversation.id },
    onFinish: async ({ responseMessage, isAborted }) => {
      // An abandoned stream still recorded whatever was said before it stopped,
      // which is what makes the transcript trustworthy as a record.
      await appendMessages(ctx, conversation.id, [
        {
          role: "assistant",
          parts: responseMessage.parts,
          text: messageText(responseMessage),
          modelId: modelId(),
        },
      ]);
      if (isAborted) {
        console.warn("[assistant] stream aborted", { conversationId: conversation.id });
      }
    },
  });

  // The client needs the id to continue this thread on the next turn.
  const headers = new Headers(response.headers);
  headers.set("x-conversation-id", conversation.id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
