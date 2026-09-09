/**
 * Leash Plus — the membership domain.
 *
 * The billing authority is the provider, not this table. Every field here is
 * written from a webhook payload, and `applySubscriptionSnapshot` is the only
 * function that writes them, so there is one place where provider truth becomes
 * our truth.
 *
 * `getMembership` in ./entitlements is the read side, and is what every pricing
 * path consults. Nothing outside this file decides whether somebody is a member.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "./ids";
import { notify } from "./notifications";
import { DUNNING_GRACE_DAYS } from "./entitlements";
import type { Plan as PlanShape, SubscriptionStatus } from "@/types";

export interface SubscriptionSnapshot {
  providerRef: string;
  providerCustomerId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt?: string | null;
  endedAt?: string | null;
  latestInvoiceRef?: string;
  /** Which plan, resolved from the provider's price id. */
  planId: string;
  userId: string;
}

export function toPlan(row: {
  id: string;
  key: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: string;
  entitlements: string[];
  consultDiscountPct: number;
  active: boolean;
  stripePriceId: string;
}): PlanShape {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
    entitlements: row.entitlements as PlanShape["entitlements"],
    consultDiscountPct: row.consultDiscountPct,
    active: row.active,
    // A plan with no price in the provider cannot be bought, and the marketing
    // page needs to know that before it renders a button that would 503.
    purchasable: row.active && row.stripePriceId !== "",
  };
}

export async function getPlanByKey(
  key: string,
  db: PrismaClient = defaultPrisma
): Promise<PlanShape | null> {
  const row = await db.plan.findUnique({ where: { key } });
  return row ? toPlan(row) : null;
}

export async function getPlanByPriceId(
  stripePriceId: string,
  db: PrismaClient = defaultPrisma
) {
  if (!stripePriceId) return null;
  return db.plan.findFirst({ where: { stripePriceId } });
}

export type SnapshotResult =
  | { ok: true; changed: boolean; subscriptionId: string }
  | { ok: false; code: "stale" }
  | { ok: false; code: "unknown_plan" };

/**
 * Write provider state onto our row, last-writer-wins by **event time**.
 *
 * The ordering rule is the important part. Subscription payloads carry complete
 * current state, so overwriting wholesale is correct — but only if "last" means
 * most recently *created*, not most recently *arrived*. Webhooks arrive out of
 * order, and a delayed `past_due` update landing after a later `invoice.paid`
 * would silently strip a paying member's benefits.
 */
export async function applySubscriptionSnapshot(
  snapshot: SubscriptionSnapshot,
  eventAt: string,
  db: PrismaClient = defaultPrisma
): Promise<SnapshotResult> {
  const existing = await db.subscription.findUnique({
    where: { providerRef: snapshot.providerRef },
  });

  if (existing?.lastEventAt && eventAt < existing.lastEventAt) {
    return { ok: false, code: "stale" };
  }

  const plan = await db.plan.findUnique({ where: { id: snapshot.planId } });
  if (!plan) return { ok: false, code: "unknown_plan" };

  const now = nowIso();
  const enteringDunning = snapshot.status === "past_due";

  const data = {
    userId: snapshot.userId,
    planId: snapshot.planId,
    providerCustomerId: snapshot.providerCustomerId,
    status: snapshot.status,
    currentPeriodStart: snapshot.currentPeriodStart,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    canceledAt: snapshot.canceledAt ?? null,
    endedAt: snapshot.endedAt ?? null,
    latestInvoiceRef: snapshot.latestInvoiceRef ?? "",
    // Set when dunning starts, cleared when it stops. Benefits survive until it
    // passes; see DUNNING_GRACE_DAYS for why that window exists at all.
    graceEndsAt: enteringDunning
      ? (existing?.graceEndsAt ??
        new Date(Date.now() + DUNNING_GRACE_DAYS * 86_400_000).toISOString())
      : null,
    lastEventAt: eventAt,
    updatedAt: now,
  };

  if (existing) {
    await db.subscription.update({ where: { id: existing.id }, data });
    await announceStatusChange(
      existing.status as SubscriptionStatus,
      snapshot.status,
      snapshot.userId,
      db
    );
    return { ok: true, changed: existing.status !== snapshot.status, subscriptionId: existing.id };
  }

  const created = await db.subscription.create({
    data: {
      ...data,
      id: genId("sub"),
      provider: "stripe",
      providerRef: snapshot.providerRef,
      createdAt: now,
    },
  });
  await announceStatusChange(null, snapshot.status, snapshot.userId, db);
  return { ok: true, changed: true, subscriptionId: created.id };
}

/**
 * Tell the member what happened — but only about things they'd want to know.
 *
 * Deliberately silent on a successful renewal. Nobody wants a monthly "we
 * charged you" in their notification bell, and Stripe emails the receipt.
 */
async function announceStatusChange(
  from: SubscriptionStatus | null,
  to: SubscriptionStatus,
  userId: string,
  db: PrismaClient
): Promise<void> {
  if (from === to) return;

  if (to === "active" && (from === null || from === "incomplete")) {
    await notify(
      userId,
      {
        kind: "membership_started",
        title: "Welcome to Leash Plus",
        body: "Free delivery, a discount on every vet consultation, and same-day booking.",
        href: "/account/membership",
      },
      db
    );
    return;
  }

  if (to === "past_due") {
    await notify(
      userId,
      {
        kind: "membership_payment_failed",
        title: "We couldn't renew your membership",
        body: `Your card was declined. Your benefits continue for ${DUNNING_GRACE_DAYS} days while we retry — update your card to keep them.`,
        href: "/account/membership",
      },
      db
    );
    return;
  }

  if (to === "canceled") {
    await notify(
      userId,
      {
        kind: "membership_ended",
        title: "Your Leash Plus membership has ended",
        body: "Free delivery and the consultation discount no longer apply. You can rejoin any time.",
        href: "/plus",
      },
      db
    );
  }
}

/** The member's current subscription row, whatever state it is in. */
export async function getSubscriptionForUser(
  userId: string,
  db: PrismaClient = defaultPrisma
) {
  return db.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  });
}

export async function findUserForCustomer(
  customerRef: string,
  db: PrismaClient = defaultPrisma
): Promise<string | null> {
  if (!customerRef) return null;
  const user = await db.user.findUnique({
    where: { stripeCustomerId: customerRef },
    select: { id: true },
  });
  return user?.id ?? null;
}
