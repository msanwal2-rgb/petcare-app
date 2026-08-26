/**
 * The assistant's tool surface.
 *
 * ── Why this is a factory, and not a module-level object ─────────────
 *
 * Everything the assistant is allowed to see or do is decided here, once per
 * request, from a context built out of `requireUser()`. Three properties fall
 * out of that, and together they are the whole security argument for this
 * feature:
 *
 * 1. **No tool takes a user id.** Not one `inputSchema` in this directory has a
 *    `userId`, `ownerId` or `uid` field, so there is no way for the model to
 *    ask about somebody else. It is not that such a request would be refused —
 *    it cannot be expressed. (A test asserts this, so it stays true.)
 *
 * 2. **Anonymous callers get a smaller tool list, not refusals.** Write tools
 *    are absent entirely when `ctx.uid` is null, so the model never offers to
 *    cancel an order for someone who is not signed in and then fails.
 *
 * 3. **Every id the model does pass is re-checked server-side.** The guards in
 *    ../guards run on every call and consult the database, never the
 *    conversation. A model that "remembers" owning an order from three turns
 *    ago is still refused if it does not.
 *
 * What is deliberately missing is as important as what is here: no tool places
 * an order, creates a booking or appointment, writes a medical record, posts a
 * review, edits a profile, or touches anything gated on `isOps`. Nor is there
 * any access to booking messages — a support bot must not be able to speak to a
 * caretaker as the customer.
 */

import type { AssistantContext } from "../context";
import { readTools, type ToolDeps } from "./reads";
import { writeTools } from "./writes";
import { linkTools } from "./links";
import { clientTools } from "./client";

export type { ToolDeps };

export function buildTools(ctx: AssistantContext, deps: ToolDeps = {}) {
  return {
    ...readTools(ctx, deps),
    ...linkTools(ctx),
    ...clientTools(),
    // Signed-in only. Spread last and conditionally, so the absence is obvious.
    ...(ctx.uid ? writeTools(ctx) : {}),
  };
}

export type AssistantTools = ReturnType<typeof buildTools>;

/** Tool names, for the prompt's capability list and for tests. */
export function toolNames(ctx: AssistantContext): string[] {
  return Object.keys(buildTools(ctx)).sort();
}
