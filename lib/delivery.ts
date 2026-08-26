/**
 * Order lifecycle facts: how long each fulfilment stage takes, and how late a
 * customer may still cancel.
 *
 * Deliberately dependency-free, for the same reason lib/pricing.ts is: these
 * are consulted from three places that must not disagree — the server (which
 * is the authority), the order-detail page (which decides whether to render a
 * Cancel button), and the support content that tells customers the rules. When
 * this lived inside lib/server/*, anything client-side had to hand-copy it,
 * and a hand-copied list drifts the first time someone edits one of them.
 *
 * Importing this file pulls in nothing — no Prisma, no server code — so it is
 * safe from a client component and from a plain node script.
 */

import type { OrderStatus } from "@/types";

/**
 * How long after being placed an order reaches each stage. Loosely modelled on
 * a real two-to-three day courier, compressed enough that a demo order placed
 * in the morning has moved by the afternoon.
 */
export const FULFILMENT_SCHEDULE: { status: OrderStatus; afterHours: number }[] = [
  { status: "processing", afterHours: 1 },
  { status: "packed", afterHours: 6 },
  { status: "shipped", afterHours: 24 },
  { status: "out_for_delivery", afterHours: 48 },
  { status: "delivered", afterHours: 60 },
];

/** The furthest stage an order placed at `placedAt` has earned by `now`. */
export function earnedStatus(placedAt: string, now: Date): OrderStatus {
  const hours = (now.getTime() - new Date(placedAt).getTime()) / 3_600_000;
  let earned: OrderStatus = "paid";
  for (const stage of FULFILMENT_SCHEDULE) {
    if (hours >= stage.afterHours) earned = stage.status;
  }
  return earned;
}

/**
 * Statuses a customer may still cancel from themselves. Once a parcel is
 * shipped it is out of our hands and the answer is a return, not a
 * cancellation.
 */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = [
  "pending_payment",
  "paid",
  "processing",
  "packed",
];

export function canCustomerCancel(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE.includes(status);
}

/** Hours after placement at which cancellation stops being possible. */
export function hoursUntilUncancellable(): number {
  const firstUncancellable = FULFILMENT_SCHEDULE.find(
    (stage) => !CUSTOMER_CANCELLABLE.includes(stage.status),
  );
  return firstUncancellable?.afterHours ?? Infinity;
}
