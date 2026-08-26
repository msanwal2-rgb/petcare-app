/**
 * GET/DELETE /api/assistant/conversations/:id
 *
 * Hydrating a thread after a reload, and clearing it. Both are scoped to the
 * caller: a conversation belonging to someone else reads as 404, not 403, so
 * ids cannot be probed. Anonymous threads are reachable only by the client key
 * that created them.
 */

import { auth } from "@/auth";
import { notFound, ok } from "@/lib/server/http";
import { buildContext } from "@/lib/server/assistant/context";
import {
  deleteConversation,
  getConversationForCaller,
} from "@/lib/server/assistant/conversations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await auth();
  const context = buildContext(request, session?.user?.id ?? null);

  const conversation = await getConversationForCaller(context, id);
  if (!conversation) return notFound("No such conversation.");
  return ok(conversation);
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await auth();
  const context = buildContext(request, session?.user?.id ?? null);

  const removed = await deleteConversation(context, id);
  if (!removed) return notFound("No such conversation.");
  return new Response(null, { status: 204 });
}
