/**
 * Per-request context for the assistant.
 *
 * Built once in the route handler from the real session and handed to the tool
 * factory. This is the object that makes the security story work: `uid` comes
 * from `requireUser()` and from nowhere else, so no tool ever accepts a user id
 * as an argument and the model has no way to name a user other than the one
 * signed in.
 *
 * Discarded when the request ends. Nothing here is cached across requests.
 */

import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";

export interface AssistantContext {
  /** The signed-in user, or null for an anonymous visitor. Never model-supplied. */
  uid: string | null;
  db: PrismaClient;
  /** Real wall-clock time. Passed explicitly so tests can pin it. */
  now: Date;
  /**
   * A stable, non-identifying handle for an anonymous visitor, used only to
   * rate-limit them. A salted hash rather than the raw IP, so the rate-limit
   * table never becomes a log of who visited.
   */
  clientKey: string;
  /** The page the customer is on, so "cancel this" has a referent. */
  path: string;
}

/**
 * Derive the anonymous rate-limit key.
 *
 * The salt matters: without it, this is a rainbow table away from being a list
 * of visitor IPs. With a secret salt the hash is useless to anyone who steals
 * the table, and still stable enough to count against.
 */
export function clientKeyFor(request: Request): string {
  const salt = process.env.ASSISTANT_CLIENT_SALT ?? process.env.AUTH_SECRET ?? "";
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const agent = request.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${salt}:${ip}:${agent}`).digest("hex").slice(0, 32);
}

export function buildContext(
  request: Request,
  uid: string | null,
  options: { db?: PrismaClient; now?: Date; path?: string } = {},
): AssistantContext {
  return {
    uid,
    db: options.db ?? defaultPrisma,
    now: options.now ?? new Date(),
    clientKey: clientKeyFor(request),
    path: options.path ?? "/",
  };
}
