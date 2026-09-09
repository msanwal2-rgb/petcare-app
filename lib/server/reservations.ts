/**
 * Stock held by a checkout that hasn't paid yet.
 *
 * Reserving stock at order creation buys correctness — two customers cannot
 * both be sold the last unit — at the cost of a new failure mode: someone
 * opens checkout, reserves the last bag of food, and closes the tab. The hold
 * has to lapse.
 *
 * A fifteen-minute reaper is the obvious answer and is not available: Vercel's
 * Hobby plan fires a cron at most once a day, which is the same constraint that
 * shaped `advanceDueOrders` into something time-based rather than
 * step-per-tick. So holds are **reclaimable rather than reclaimed** — the sweep
 * runs inside checkout, on exactly the products someone is trying to buy, at
 * the only moment the answer matters. The daily cron then only tidies up the
 * *status* of the abandoned orders, so they stop sitting in a customer's list
 * forever.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";

/**
 * How long an unpaid order holds its stock.
 *
 * Long enough for a bank's 3-D Secure challenge and a fumbled card entry, short
 * enough that an abandoned tab does not keep a popular product out of stock for
 * an afternoon.
 */
export const RESERVATION_TTL_MINUTES = 15;

export function reservationDeadline(from: string = new Date().toISOString()): string {
  return new Date(Date.parse(from) + RESERVATION_TTL_MINUTES * 60_000).toISOString();
}

/** Orders that still hold stock they have not paid for. */
const HOLDING = { status: "pending_payment" } as const;

/**
 * Release stock held by expired, still-unpaid orders touching these products.
 *
 * Called inside `createOrder`'s transaction, before the conditional decrement,
 * so a reclaim and the purchase that triggered it either both happen or neither
 * does.
 *
 * Scoped to the products in the cart rather than sweeping the table: this runs
 * on the checkout path, and a full scan there would make every purchase pay for
 * everyone else's abandoned ones.
 */
export async function releaseExpiredReservations(
  productIds: string[],
  now: string,
  tx: Prisma.TransactionClient
): Promise<{ released: number; orderIds: string[] }> {
  if (productIds.length === 0) return { released: 0, orderIds: [] };

  const expired = await tx.order.findMany({
    where: {
      ...HOLDING,
      reservationExpiresAt: { not: null, lt: now },
      items: { some: { productId: { in: productIds } } },
    },
    include: { items: true },
  });
  if (expired.length === 0) return { released: 0, orderIds: [] };

  for (const order of expired) {
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stockQty: { increment: item.quantity } },
      });
    }
    // Clearing the deadline is what marks the stock as already given back, so a
    // concurrent reclaim of the same order cannot return it twice.
    await tx.order.update({
      where: { id: order.id },
      data: { reservationExpiresAt: null, status: "cancelled" },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        status: "cancelled",
        label: "Checkout expired",
        description:
          "This order was never paid for, so the items were returned to the shop.",
        occurredAt: now,
      },
    });
  }

  return {
    released: expired.length,
    orderIds: expired.map((o) => o.id),
  };
}

/**
 * The read-only question: which of these products have stock that is only
 * notionally taken? Used by `quoteCart` so the cart tells the truth about
 * availability without needing a write.
 */
export async function heldButExpiredCount(
  productId: string,
  now: string = new Date().toISOString(),
  db: PrismaClient = defaultPrisma
): Promise<number> {
  const rows = await db.orderItem.findMany({
    where: {
      productId,
      order: { ...HOLDING, reservationExpiresAt: { not: null, lt: now } },
    },
    select: { quantity: true },
  });
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

/**
 * Close out abandoned checkouts platform-wide. Housekeeping for the daily cron:
 * correctness already lives in the checkout path, so this only stops dead
 * orders lingering in customers' order lists.
 */
export async function sweepAbandonedCheckouts(
  now: string = new Date().toISOString(),
  db: PrismaClient = defaultPrisma
): Promise<{ released: number; orderIds: string[] }> {
  const stale = await db.order.findMany({
    where: { ...HOLDING, reservationExpiresAt: { not: null, lt: now } },
    select: { items: { select: { productId: true } } },
  });
  const productIds = [
    ...new Set(stale.flatMap((o) => o.items.map((i) => i.productId))),
  ];
  if (productIds.length === 0) return { released: 0, orderIds: [] };

  return db.$transaction((tx) => releaseExpiredReservations(productIds, now, tx), {
    timeout: 20_000,
  });
}
