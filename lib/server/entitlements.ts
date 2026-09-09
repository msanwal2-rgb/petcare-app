/**
 * Membership, and what it entitles someone to.
 *
 * The rule this module exists to enforce: **the session token carries identity
 * and nothing else.** Membership is read from the database, in the same request
 * that prices the thing it affects.
 *
 * The tempting alternative is a `plus: true` claim in the JWT. It is wrong here
 * for two concrete reasons. Sessions are JWTs with no database adapter, so
 * there is no session row to invalidate — a claim minted at signup keeps
 * asserting itself after a cancellation or a failed renewal for the token's
 * whole thirty-day life, and the *user* decides when to re-authenticate. And
 * refreshing the claim per request means a database read anyway, in
 * `auth.config.ts`, which is deliberately free of database imports because
 * `proxy.ts` loads it on the Edge runtime.
 *
 * Like ./access.ts, this file imports nothing from Auth.js, so the unit suite
 * can exercise it directly against a real schema.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { nowIso } from "./ids";
import type { Entitlement, Membership, SubscriptionStatus } from "@/types";

export const NO_MEMBERSHIP: Membership = {
  active: false,
  planKey: null,
  planName: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  inGrace: false,
  entitlements: [],
  consultDiscountPct: 0,
};

/** Statuses that can still carry benefits, before the grace check. */
const LIVE: SubscriptionStatus[] = ["trialing", "active", "past_due"];

/**
 * How long benefits survive a failed renewal.
 *
 * A business decision, stated here so it can be argued with rather than
 * discovered: Stripe retries a failed charge over about three weeks, and
 * stripping someone's free shipping the moment their card expires — mid-order,
 * while the retry is still pending — punishes them for a bank's timing.
 */
export const DUNNING_GRACE_DAYS = 7;

export async function getMembership(
  userId: string,
  now: string = nowIso(),
  db: PrismaClient = defaultPrisma
): Promise<Membership> {
  const sub = await db.subscription.findFirst({
    where: { userId, status: { in: LIVE } },
    orderBy: { currentPeriodEnd: "desc" },
    include: { plan: true },
  });
  if (!sub) return NO_MEMBERSHIP;

  const status = sub.status as SubscriptionStatus;
  const inGrace = status === "past_due";

  // Past due keeps its benefits until the grace window closes; anything else
  // keeps them until the period it was paid for actually ends.
  const stillGood = inGrace
    ? Boolean(sub.graceEndsAt && now < sub.graceEndsAt)
    : now < sub.currentPeriodEnd;

  if (!stillGood) return NO_MEMBERSHIP;

  return {
    active: true,
    planKey: sub.plan.key,
    planName: sub.plan.name,
    status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    inGrace,
    entitlements: sub.plan.entitlements as Entitlement[],
    consultDiscountPct: sub.plan.consultDiscountPct,
  };
}

export async function hasEntitlement(
  userId: string,
  entitlement: Entitlement,
  now: string = nowIso(),
  db: PrismaClient = defaultPrisma
): Promise<boolean> {
  const membership = await getMembership(userId, now, db);
  return membership.entitlements.includes(entitlement);
}
