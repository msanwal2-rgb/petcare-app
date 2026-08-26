/**
 * Rate limiting for a public LLM endpoint.
 *
 * This is the one piece that has to exist before the feature ships rather than
 * after: /api/assistant/chat is reachable without signing in, and every call
 * costs money. An unlimited endpoint is a bill waiting to happen.
 *
 * Counted in Postgres rather than Redis, because this stack does not have
 * Redis and adding one for two counters would be the wrong trade. Two indexed
 * `count` queries per request is cheap, and it uses the Prisma model API — not
 * raw SQL — so the schema-qualification hazard that applies to the vector
 * queries does not apply here.
 *
 * The window is a true sliding one, not an hourly bucket: ISO-8601 strings
 * sort chronologically, which is the whole reason this codebase stores
 * timestamps as strings, so `createdAt >= <one hour ago>` is a plain indexed
 * comparison. A bucket would let someone spend two hours' budget in the two
 * minutes either side of the hour.
 */

import type { PrismaClient } from "@prisma/client";
import type { AssistantContext } from "./context";

export interface RateLimit {
  perHour: number;
  perDay: number;
}

/**
 * Anonymous visitors get enough to answer a real pre-sale question and not
 * enough to be worth abusing. Signed-in customers get roughly a working
 * afternoon's worth of support conversation.
 */
export const LIMITS: { anonymous: RateLimit; signedIn: RateLimit } = {
  anonymous: { perHour: 10, perDay: 30 },
  signedIn: { perHour: 40, perDay: 200 },
};

export interface RateLimitVerdict {
  allowed: boolean;
  /** Which window was exceeded, when one was. */
  window?: "hour" | "day";
  limit?: number;
  used?: number;
  /** Ready-made, non-technical explanation. */
  message?: string;
}

function isoAgo(from: Date, milliseconds: number): string {
  return new Date(from.getTime() - milliseconds).toISOString();
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Count the caller's own user messages in a window.
 *
 * Scoped through the conversation, so a signed-in customer is counted by user
 * id across every conversation they have, and an anonymous one by their
 * client key. Assistant replies are not counted — the customer controls how
 * many questions they ask, not how many times the model answers.
 */
async function countSince(
  ctx: AssistantContext,
  since: string,
  db: PrismaClient,
): Promise<number> {
  return db.assistantMessage.count({
    where: {
      role: "user",
      createdAt: { gte: since },
      conversation: ctx.uid ? { userId: ctx.uid } : { clientKey: ctx.clientKey },
    },
  });
}

export async function checkRateLimit(
  ctx: AssistantContext,
  limits: RateLimit = ctx.uid ? LIMITS.signedIn : LIMITS.anonymous,
): Promise<RateLimitVerdict> {
  const db = ctx.db;

  const [hourUsed, dayUsed] = await Promise.all([
    countSince(ctx, isoAgo(ctx.now, HOUR), db),
    countSince(ctx, isoAgo(ctx.now, DAY), db),
  ]);

  if (hourUsed >= limits.perHour) {
    return {
      allowed: false,
      window: "hour",
      limit: limits.perHour,
      used: hourUsed,
      message: ctx.uid
        ? "You've reached the chat limit for this hour. Try again shortly."
        : "You've reached the chat limit for this hour. Signing in raises it considerably.",
    };
  }

  if (dayUsed >= limits.perDay) {
    return {
      allowed: false,
      window: "day",
      limit: limits.perDay,
      used: dayUsed,
      message: ctx.uid
        ? "You've reached the chat limit for today. It resets on a rolling 24-hour basis."
        : "You've reached the chat limit for today. Signing in raises it considerably.",
    };
  }

  return { allowed: true, used: hourUsed };
}
