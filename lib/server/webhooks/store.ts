/**
 * Webhook idempotency.
 *
 * The obvious implementation is "insert the event id; on conflict, return 200".
 * That loses events. Insert `received`, crash halfway through processing, and
 * the provider's retry hits the conflict and is told everything is fine — the
 * event is gone, permanently, and the only symptom is an order that never got
 * marked paid.
 *
 * So claiming an event has four outcomes, not two, and the difference between
 * "somebody is working on this right now" and "somebody died working on this"
 * is a lock timestamp.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { nowIso } from "../ids";

/** How long an in-flight claim is trusted before it is presumed dead. */
export const LOCK_TTL_MS = 5 * 60_000;

/** How many times a failing event is retried before it is left alone. */
export const MAX_ATTEMPTS = 5;

export type EventClaim =
  /** Nobody has seen this event. Process it. */
  | { claim: "new" }
  /** Already processed. Answer 200 and do nothing. */
  | { claim: "duplicate" }
  /** A previous attempt died mid-flight, or failed. Process it again. */
  | { claim: "retry"; attempts: number }
  /** Another worker holds it. Answer 500 so the provider redelivers later. */
  | { claim: "in_flight" }
  /** Failed too many times. Answer 200; a human replays it from the console. */
  | { claim: "exhausted"; attempts: number };

export interface IncomingEvent {
  id: string;
  type: string;
  /** The provider's own creation time, as ISO. Not arrival time. */
  eventAt: string;
  apiVersion?: string;
  payload: unknown;
}

export async function claimEvent(
  event: IncomingEvent,
  now: Date = new Date(),
  db: PrismaClient = defaultPrisma
): Promise<EventClaim> {
  const nowIsoStr = now.toISOString();

  // `skipDuplicates` turns the race into a value we can branch on rather than
  // an exception we have to interpret.
  const { count } = await db.webhookEvent.createMany({
    data: [
      {
        id: event.id,
        provider: "stripe",
        type: event.type,
        apiVersion: event.apiVersion ?? "",
        eventAt: event.eventAt,
        payload: event.payload as never,
        status: "received",
        attempts: 1,
        lockedAt: nowIsoStr,
        receivedAt: nowIsoStr,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 1) return { claim: "new" };

  const existing = await db.webhookEvent.findUnique({ where: { id: event.id } });
  if (!existing) return { claim: "in_flight" }; // vanished under us; let it retry

  if (existing.status === "processed" || existing.status === "skipped") {
    return { claim: "duplicate" };
  }

  if (existing.attempts >= MAX_ATTEMPTS) {
    return { claim: "exhausted", attempts: existing.attempts };
  }

  const lockAge = existing.lockedAt
    ? now.getTime() - Date.parse(existing.lockedAt)
    : Infinity;

  if (existing.status === "received" && lockAge < LOCK_TTL_MS) {
    return { claim: "in_flight" };
  }

  const bumped = await db.webhookEvent.update({
    where: { id: event.id },
    data: { attempts: { increment: 1 }, lockedAt: nowIsoStr, status: "received" },
  });
  return { claim: "retry", attempts: bumped.attempts };
}

export async function markProcessed(
  id: string,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "processed", processedAt: nowIso(), lockedAt: null, error: "" },
  });
}

export async function markFailed(
  id: string,
  error: string,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "failed", lockedAt: null, error: error.slice(0, 1000) },
  });
}

/**
 * Processed, in the sense that there is nothing to do — an event type we don't
 * handle, one about a subject we can't resolve, or one that arrived too late to
 * matter. Distinct from "failed" so the console can tell them apart.
 */
export async function markSkipped(
  id: string,
  reason: string,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "skipped", processedAt: nowIso(), lockedAt: null, error: reason },
  });
}

/**
 * Drop the payloads of old, settled events.
 *
 * They contain email addresses and card last-fours, and there is no reason to
 * keep them once nobody is going to replay them. Called from the daily cron.
 */
export async function purgeOldEvents(
  now: Date = new Date(),
  retentionDays = 90,
  db: PrismaClient = defaultPrisma
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const { count } = await db.webhookEvent.deleteMany({
    where: { status: { in: ["processed", "skipped"] }, receivedAt: { lt: cutoff } },
  });
  return count;
}
