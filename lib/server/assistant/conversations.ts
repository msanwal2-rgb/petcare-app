/**
 * Conversation persistence.
 *
 * Threads are kept for three reasons: a customer who reloads the page keeps
 * their conversation, the rate limiter has something to count, and there is a
 * record of what the assistant told people — which matters rather a lot for a
 * bot that discusses orders and pet health.
 *
 * `parts` stores the whole UIMessage parts array rather than flattened prose,
 * because that is what lets a reloaded thread re-render its tool cards exactly
 * as they first appeared. The flattened `text` is kept alongside it so the rate
 * limiter and any future search never have to walk the JSON.
 *
 * Access is scoped the same way everything else in this codebase is: by user id
 * when signed in, and by the anonymous client key otherwise. A conversation
 * belonging to someone else reads as absent, not as forbidden.
 */

import type { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "@/lib/server/ids";
import type { AssistantContext } from "./context";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown;
  text: string;
  createdAt: string;
}

export interface StoredConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredMessage[];
}

/** How many turns a single thread keeps. Beyond this the oldest are dropped. */
const MAX_STORED_MESSAGES = 200;

function scopeFor(ctx: AssistantContext): Prisma.AssistantConversationWhereInput {
  // An anonymous conversation is reachable only by the client key that made it;
  // a signed-in one only by its owner. Never both, so a shared device cannot
  // surface the previous visitor's thread.
  return ctx.uid ? { userId: ctx.uid } : { userId: null, clientKey: ctx.clientKey };
}

export async function createConversation(
  ctx: AssistantContext,
  title = "",
): Promise<StoredConversation> {
  const now = nowIso();
  const row = await ctx.db.assistantConversation.create({
    data: {
      id: genId("ac"),
      userId: ctx.uid,
      clientKey: ctx.clientKey,
      title,
      createdAt: now,
      updatedAt: now,
    },
  });
  return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt, messages: [] };
}

/**
 * Fetch a conversation the caller is entitled to. Returns null for one that
 * does not exist *and* for one belonging to someone else — the caller cannot
 * tell the difference, which is the point.
 */
export async function getConversationForCaller(
  ctx: AssistantContext,
  conversationId: string,
): Promise<StoredConversation | null> {
  const row = await ctx.db.assistantConversation.findFirst({
    where: { id: conversationId, ...scopeFor(ctx) },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    messages: row.messages.map((message) => ({
      id: message.id,
      role: message.role as "user" | "assistant",
      parts: message.parts,
      text: message.text,
      createdAt: message.createdAt,
    })),
  };
}

/** Find the caller's conversation, or start one. */
export async function ensureConversation(
  ctx: AssistantContext,
  conversationId?: string,
): Promise<StoredConversation> {
  if (conversationId) {
    const existing = await getConversationForCaller(ctx, conversationId);
    if (existing) return existing;
  }
  return createConversation(ctx);
}

export interface AppendInput {
  role: "user" | "assistant";
  parts: unknown;
  text: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function appendMessages(
  ctx: AssistantContext,
  conversationId: string,
  messages: AppendInput[],
): Promise<void> {
  if (messages.length === 0) return;
  const now = nowIso();

  await ctx.db.assistantMessage.createMany({
    data: messages.map((message, index) => ({
      id: genId("am"),
      conversationId,
      role: message.role,
      parts: message.parts as Prisma.InputJsonValue,
      text: message.text,
      modelId: message.modelId ?? "",
      inputTokens: message.inputTokens ?? 0,
      outputTokens: message.outputTokens ?? 0,
      // Nudge each id forward a millisecond so a batch written in one call
      // still sorts in the order it was said.
      createdAt: new Date(new Date(now).getTime() + index).toISOString(),
    })),
  });

  // Title the thread from its first question, so a list of conversations reads
  // as something other than a column of ids. Only the first one titles it;
  // after that the title stands.
  const firstQuestion = messages.find((message) => message.role === "user");
  const current = firstQuestion
    ? await ctx.db.assistantConversation.findUnique({
        where: { id: conversationId },
        select: { title: true },
      })
    : null;
  const title =
    firstQuestion && current && !current.title
      ? firstQuestion.text.slice(0, 80)
      : undefined;

  await ctx.db.assistantConversation.update({
    where: { id: conversationId },
    // `title` is omitted rather than set to undefined: Prisma reads an explicit
    // `{ set: undefined }` as a malformed update, not as "leave it alone".
    data: title === undefined ? { updatedAt: now } : { updatedAt: now, title },
  });

  await trimConversation(ctx, conversationId);
}

/** Keep a runaway thread from growing without bound. */
async function trimConversation(
  ctx: AssistantContext,
  conversationId: string,
): Promise<void> {
  const total = await ctx.db.assistantMessage.count({ where: { conversationId } });
  if (total <= MAX_STORED_MESSAGES) return;

  const excess = await ctx.db.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: total - MAX_STORED_MESSAGES,
    select: { id: true },
  });
  await ctx.db.assistantMessage.deleteMany({
    where: { id: { in: excess.map((row) => row.id) } },
  });
}

export async function deleteConversation(
  ctx: AssistantContext,
  conversationId: string,
): Promise<boolean> {
  const { count } = await ctx.db.assistantConversation.deleteMany({
    where: { id: conversationId, ...scopeFor(ctx) },
  });
  return count > 0;
}

/** A signed-in customer's recent threads. Not yet surfaced in the UI. */
export async function listConversationsByUser(
  userId: string,
  db: PrismaClient = defaultPrisma,
  take = 20,
): Promise<{ id: string; title: string; updatedAt: string }[]> {
  return db.assistantConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, title: true, updatedAt: true },
  });
}
