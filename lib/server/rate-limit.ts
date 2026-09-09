/**
 * Rate limiting for the credential endpoints.
 *
 * The assistant has had a limiter since it shipped, because every call there
 * costs money. Sign-in, sign-up and password reset cost an *attacker* nothing,
 * which is the more interesting asymmetry: unlimited sign-in attempts are
 * offline password cracking with the server doing the bcrypt, and an unlimited
 * "email me a reset link" is a way to use this domain to flood someone's inbox.
 *
 * The counting strategy is lifted from lib/server/assistant/rate-limit.ts —
 * Postgres, a true sliding window over ISO-8601 strings — but the storage is
 * its own table, because there is no domain row to count for a *failed* login.
 *
 * Two rules worth stating, since both are easy to get backwards:
 *
 *  - Sign-in is counted per attempt and the counter is *cleared on success*, so
 *    a legitimate user who mistypes twice and then gets it right starts fresh.
 *    An attacker never gets that reset.
 *  - Sign-in is limited per email *and* per client. Per-email alone lets a
 *    botnet spread one password across every account; per-client alone lets one
 *    attacker rotate addresses. Neither is sufficient; together they cover both
 *    shapes, and a single legitimate user trips neither.
 */

import { createHash } from "crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId } from "./ids";
import { error } from "./http";

export interface RateLimitRule {
  bucket: string;
  /** Attempts permitted inside the window. */
  limit: number;
  windowMs: number;
  /** Shown to the caller when they exceed it. Never mentions which limit tripped. */
  message: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The limits. Generous enough that a real person never sees one, tight enough
 * that automation does.
 */
export const RATE_LIMITS = {
  /** Per email address. Cleared on a successful sign-in. */
  signinEmail: {
    bucket: "signin:email",
    limit: 8,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in attempts. Try again in a few minutes.",
  },
  /** Per client, across every address they try. */
  signinClient: {
    bucket: "signin:client",
    limit: 20,
    windowMs: 15 * MINUTE,
    message: "Too many sign-in attempts. Try again in a few minutes.",
  },
  signup: {
    bucket: "signup",
    limit: 5,
    windowMs: HOUR,
    message: "Too many accounts created from here. Try again later.",
  },
  /** Covers forgot-password, reset-password and resend-verification. */
  emailSend: {
    bucket: "email-send",
    limit: 5,
    windowMs: HOUR,
    message: "Too many requests. Check your inbox, or try again later.",
  },
  /** Admin writes: a compromised staff session should not be able to script mass changes. */
  adminWrite: {
    bucket: "admin-write",
    limit: 120,
    windowMs: HOUR,
    message: "Too many administrative changes in a short time.",
  },
  /**
   * Endpoints that call the payment provider on the caller's behalf. Each one
   * is a billable third-party round trip somebody else pays for, and the
   * confirmation pages poll them — generous enough for a page that retries five
   * times, tight enough that a loop is not free.
   */
  providerSync: {
    bucket: "provider-sync",
    limit: 60,
    windowMs: HOUR,
    message: "Too many refresh attempts. Give it a moment and reload.",
  },
  /** Starting a checkout: creates a customer and a session at the provider. */
  checkout: {
    bucket: "checkout",
    limit: 10,
    windowMs: HOUR,
    message: "Too many checkout attempts. Try again shortly.",
  },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Derive a stable, non-identifying key for an unauthenticated caller.
 *
 * Salted, so the table never becomes a list of visitor IPs — the same reasoning
 * (and the same salt) as the assistant's `clientKeyFor`.
 */
export function clientKey(request: Request): string {
  const salt = process.env.ASSISTANT_CLIENT_SALT ?? process.env.AUTH_SECRET ?? "";
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip =
    forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const agent = request.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${salt}:${ip}:${agent}`).digest("hex").slice(0, 32);
}

/** Hash a subject (an email, say) so the table holds no addresses either. */
export function subjectKey(value: string): string {
  const salt = process.env.ASSISTANT_CLIENT_SALT ?? process.env.AUTH_SECRET ?? "";
  return createHash("sha256")
    .update(`${salt}:${value.toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 32);
}

export interface RateLimitVerdict {
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
}

/**
 * Record an attempt and say whether it is permitted.
 *
 * Counts first, then records, so the Nth attempt is allowed and the (N+1)th is
 * not. Recording even when refused is deliberate: it means hammering a blocked
 * endpoint keeps it blocked rather than letting the window drain while the
 * attacker keeps trying.
 */
export async function consume(
  rule: RateLimitRule,
  key: string,
  now: Date = new Date(),
  db: PrismaClient = defaultPrisma,
): Promise<RateLimitVerdict> {
  const since = new Date(now.getTime() - rule.windowMs).toISOString();

  const used = await db.rateLimitHit.count({
    where: { bucket: rule.bucket, key, createdAt: { gte: since } },
  });

  await db.rateLimitHit.create({
    data: {
      id: genId("rl"),
      bucket: rule.bucket,
      key,
      createdAt: now.toISOString(),
    },
  });

  if (used >= rule.limit) {
    return { allowed: false, used, limit: rule.limit, message: rule.message };
  }
  return { allowed: true, used: used + 1, limit: rule.limit };
}

/** Forget a subject's attempts. Called after a successful sign-in. */
export async function clear(
  rule: RateLimitRule,
  key: string,
  db: PrismaClient = defaultPrisma,
): Promise<void> {
  await db.rateLimitHit.deleteMany({ where: { bucket: rule.bucket, key } });
}

/** The standard 429, matching the shape the assistant route already returns. */
export function tooManyRequests(verdict: RateLimitVerdict): Response {
  return error(verdict.message ?? "Too many requests", 429, {
    limit: verdict.limit,
  });
}

/**
 * Guard a route in one line, in the same either/or shape as `requireUser` and
 * `parseBody`:
 *
 *   const limited = await limit(RATE_LIMITS.signup, clientKey(request));
 *   if (limited) return limited;
 */
export async function limit(
  rule: RateLimitRule,
  key: string,
  db: PrismaClient = defaultPrisma,
): Promise<Response | null> {
  const verdict = await consume(rule, key, new Date(), db);
  return verdict.allowed ? null : tooManyRequests(verdict);
}

/**
 * Drop hits that have aged out of every window. Housekeeping only — the count
 * queries are bounded by `createdAt`, so stale rows are a storage cost rather
 * than a correctness one. Called from the daily cron.
 */
export async function purgeExpired(
  now: Date = new Date(),
  db: PrismaClient = defaultPrisma,
): Promise<number> {
  const cutoff = new Date(now.getTime() - 25 * HOUR).toISOString();
  const { count } = await db.rateLimitHit.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return count;
}
