/**
 * Automatic order progress.
 *
 * There is no warehouse, so something has to move orders along. The ops console
 * does it by hand; this does it on a schedule.
 *
 * Deliberately **time-based rather than one-step-per-tick**: each order is
 * advanced to whatever stage its age has earned, however many steps that takes.
 * That matters because Vercel's Hobby plan only permits a cron to fire once a
 * day — a step-per-tick job would take most of a week to deliver one parcel.
 * Computing the stage from elapsed time instead makes the job idempotent and
 * correct at any interval: run it hourly, daily, or twice by accident, and the
 * result is the same.
 *
 * Every move goes through `updateOrderStatus`, so transitions are still
 * validated and each one writes its tracking event and customer notification.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { getOrdersForFulfillment, updateOrderStatus } from "./orders";
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

/** The order the happy path runs in, used to walk from one stage to another. */
const JOURNEY: OrderStatus[] = [
  "paid",
  ...FULFILMENT_SCHEDULE.map((s) => s.status),
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

export interface AdvanceReport {
  scanned: number;
  advanced: { orderId: string; from: OrderStatus; to: OrderStatus }[];
}

/**
 * Move every in-flight order to the stage its age has earned.
 *
 * `now` is injectable so the behaviour is testable without waiting three days.
 */
export async function advanceDueOrders(
  now: Date = new Date(),
  db: PrismaClient = defaultPrisma
): Promise<AdvanceReport> {
  const orders = await getOrdersForFulfillment(db);
  const advanced: AdvanceReport["advanced"] = [];

  for (const order of orders) {
    const from = order.status;
    // Anything off the happy path is somebody's decision, not a timing issue.
    // An unpaid order in particular is a payment problem a timer can't fix.
    const at = JOURNEY.indexOf(from);
    if (at === -1) continue;

    const target = JOURNEY.indexOf(earnedStatus(order.placedAt, now));
    if (target <= at) continue;

    // Walk the intermediate stages so every one writes its event — a customer
    // should still see it was packed before it shipped.
    for (const status of JOURNEY.slice(at + 1, target + 1)) {
      const result = await updateOrderStatus(
        order.id,
        status,
        {
          occurredAt: now.toISOString(),
          location: `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
          ...(status === "shipped"
            ? { carrier: "Leash Delivery", trackingNumber: trackingNumberFor(order.id) }
            : {}),
        },
        db
      );
      if (!result.ok) break; // a concurrent change won; leave it for next run
    }

    advanced.push({ orderId: order.id, from, to: JOURNEY[target] });
  }

  return { scanned: orders.length, advanced };
}

/** Deterministic from the order id, so a re-run never renumbers a parcel. */
function trackingNumberFor(orderId: string): string {
  const digits = orderId.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `LEASH-${digits.slice(0, 4)}-${digits.slice(4)}`;
}
