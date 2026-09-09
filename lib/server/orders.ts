/**
 * Orders — server logic. The store's equivalent of lib/server/bookings.ts, with
 * three things bookings don't have to worry about: money, stock, and a physical
 * journey to somebody's front door.
 *
 * Three rules drive the design:
 *
 *  1. The client's prices are display-only. `quoteCart` re-reads every product
 *     and recomputes the total server-side, and that quote is what gets charged.
 *  2. Stock is decremented with a conditional update inside a transaction, so
 *     two people buying the last bag can't both succeed.
 *  3. Line items snapshot the product's name, brand, image and price. A later
 *     catalog edit must never change what a customer was charged or shipped.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toOrder } from "./serialize";
import { genId, nowIso } from "./ids";
import { paymentProvider } from "./payments";
import { authorizedProductSlugs } from "./medical-records";
import { notify } from "./notifications";
import type {
  CartLineInput,
  CartProblemCode,
  CartQuote,
  NotificationKind,
  OrderStatus,
  ShippingAddress,
} from "@/types";
import type { CreateOrderBody } from "@/lib/validation/schemas";
import { getMembership, NO_MEMBERSHIP } from "./entitlements";
import { getSetting } from "./settings";
import {
  releaseExpiredReservations,
  reservationDeadline,
} from "./reservations";
import {
  applyIntentState,
  createPaymentRow,
  currentPaymentForOrder,
  requestRefund,
} from "./payments/ledger";
// Pricing lives in a dependency-free module so the cart can show a matching
// estimate without importing anything that touches the database.
import { shippingFor, taxFor } from "@/lib/pricing";
import { canCustomerCancel, CUSTOMER_CANCELLABLE } from "@/lib/delivery";

/* ── Status machine ──────────────────────────────────────────────────── */

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["paid", "cancelled"],
  paid: ["processing", "cancelled", "refunded"],
  processing: ["packed", "cancelled", "refunded"],
  packed: ["shipped", "cancelled", "refunded"],
  // Once it's with the carrier the customer cancels by refusing delivery, so
  // the only way back from here is a refund.
  shipped: ["out_for_delivery", "refunded"],
  out_for_delivery: ["delivered", "refunded"],
  delivered: ["refunded"],
  cancelled: [],
  refunded: [],
};

/**
 * Which statuses a customer may still cancel from lives in lib/delivery.ts so
 * the order page and the support content can consult the same list rather than
 * each keeping a copy. Re-exported: this is still the authority callers reach
 * for, and the server is still the only place it is enforced.
 */
export { canCustomerCancel, CUSTOMER_CANCELLABLE };

/** Customer-facing copy for each step of the journey. */
const EVENT_COPY: Record<OrderStatus, { label: string; description: string }> = {
  pending_payment: {
    label: "Order placed",
    description: "We're waiting for your payment to clear.",
  },
  paid: { label: "Payment confirmed", description: "We've received your payment." },
  processing: {
    label: "Preparing your order",
    description: "Picking items in the fulfilment centre.",
  },
  packed: { label: "Packed", description: "Your order is boxed and labelled." },
  shipped: { label: "Shipped", description: "Handed to the carrier." },
  out_for_delivery: {
    label: "Out for delivery",
    description: "On the van and heading your way.",
  },
  delivered: { label: "Delivered", description: "Left at the delivery address." },
  cancelled: {
    label: "Cancelled",
    description: "This order was cancelled and any stock returned.",
  },
  refunded: { label: "Refunded", description: "The payment has been returned." },
};

/** The delivery milestones a customer actually wants to hear about. */
const DELIVERY_NOTICES: Partial<
  Record<OrderStatus, { kind: NotificationKind; title: string; body: string }>
> = {
  shipped: {
    kind: "order_shipped",
    title: "Your order is on its way",
    body: "It's with the carrier — track it any time from your orders.",
  },
  out_for_delivery: {
    kind: "order_out_for_delivery",
    title: "Your order is out for delivery",
    body: "It's on the van and should arrive today.",
  },
  delivered: {
    kind: "order_delivered",
    title: "Your order was delivered",
    body: "Left at your delivery address. Let us know if anything's missing.",
  },
};

/* ── Reads ───────────────────────────────────────────────────────────── */

const withRelations = { items: true, events: true } as const;

export async function getOrdersByUser(
  userId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.order.findMany({
    where: { userId },
    include: withRelations,
    orderBy: { placedAt: "desc" },
  });
  return rows.map(toOrder);
}

export async function getOrderById(id: string, db: PrismaClient = defaultPrisma) {
  const o = await db.order.findUnique({ where: { id }, include: withRelations });
  return o ? toOrder(o) : null;
}

/** Orders awaiting fulfilment, oldest first — the ops queue. */
export async function getOrdersForFulfillment(db: PrismaClient = defaultPrisma) {
  const rows = await db.order.findMany({
    // `pending_payment` is excluded now that it is a state orders really
    // occupy: an unpaid basket is not a parcel, and without this the queue
    // fills with abandoned checkouts nobody should be picking.
    where: {
      status: { notIn: ["pending_payment", "delivered", "cancelled", "refunded"] },
    },
    include: withRelations,
    orderBy: { placedAt: "asc" },
  });
  return rows.map(toOrder);
}

/* ── Quoting ─────────────────────────────────────────────────────────── */

function problem(productId: string, code: CartProblemCode, message: string) {
  return { productId, code, message };
}

/**
 * Re-price a cart against the live catalog. This is the authority on what an
 * order costs; the client's numbers never reach the database.
 *
 * `petId` enables the prescription check: an Rx-only product is only allowed
 * when that pet holds a current prescription naming it.
 */
export async function quoteCart(
  lines: CartLineInput[],
  /**
   * An options object rather than more positional arguments: there were already
   * two optionals, and a third would be unreadable at every call site.
   *
   * `userId` is what makes membership pricing possible, and it always comes
   * from `requireUser()` in the route — never from the request body. There is
   * deliberately no "is a member" flag in `quoteCartSchema` or
   * `createOrderSchema`, so free shipping is not something a client can claim.
   */
  opts: { petId?: string; userId?: string } = {},
  db: PrismaClient = defaultPrisma
): Promise<CartQuote> {
  const { petId, userId } = opts;
  const products = await db.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const authorized = petId ? await authorizedProductSlugs(petId, undefined, db) : null;

  const problems: CartQuote["problems"] = [];
  const quoted: CartQuote["lines"] = [];

  for (const line of lines) {
    const product = byId.get(line.productId);
    if (!product) {
      problems.push(problem(line.productId, "not_found", "This product no longer exists."));
      continue;
    }
    if (!product.active) {
      problems.push(
        problem(product.id, "inactive", `${product.name} is no longer sold.`)
      );
      continue;
    }
    if (product.stockQty === 0) {
      problems.push(problem(product.id, "out_of_stock", `${product.name} is sold out.`));
      continue;
    }
    if (product.stockQty < line.quantity) {
      problems.push(
        problem(
          product.id,
          "insufficient_stock",
          `Only ${product.stockQty} left of ${product.name}.`
        )
      );
      continue;
    }
    if (product.requiresPrescription && !authorized?.has(product.slug)) {
      problems.push(
        problem(
          product.id,
          "prescription_required",
          `${product.name} needs a current prescription from your vet.`
        )
      );
      continue;
    }

    quoted.push({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      unitPriceCents: product.priceCents,
      quantity: line.quantity,
      lineTotalCents: product.priceCents * line.quantity,
      inStock: true,
      requiresPrescription: product.requiresPrescription,
    });
  }

  const subtotalCents = quoted.reduce((sum, l) => sum + l.lineTotalCents, 0);

  const membership = userId ? await getMembership(userId, nowIso(), db) : NO_MEMBERSHIP;
  const freeShipping = membership.entitlements.includes("free_shipping");
  const thresholdCents = await getSetting("freeShippingThresholdCents", db);

  // Nothing in the basket costs nothing to ship. Without this an empty cart
  // quotes the flat shipping rate, which is what the cart screen would show.
  const empty = quoted.length === 0;
  const shippingCents = empty ? 0 : shippingFor(subtotalCents, { freeShipping, thresholdCents });
  const taxCents = empty ? 0 : taxFor(subtotalCents);

  // What a non-member would have paid, so the UI can say what the membership
  // saved on this basket rather than only that it applied.
  const withoutMembership = empty ? 0 : shippingFor(subtotalCents, { thresholdCents });

  return {
    lines: quoted,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    problems,
    membership: { active: membership.active, planKey: membership.planKey },
    shippingWaivedByMembership: freeShipping && withoutMembership > 0,
    membershipSavingsCents: Math.max(0, withoutMembership - shippingCents),
  };
}

/* ── Checkout ────────────────────────────────────────────────────────── */

export type CreateOrderResult =
  | {
      ok: true;
      order: ReturnType<typeof toOrder>;
      /**
       * What the browser needs to finish paying. `clientSecret` is null for a
       * synchronous provider (the demo), which has already settled.
       */
      payment: { ref: string; clientSecret: string | null; provider: string };
    }
  | { ok: false; code: "empty" }
  | { ok: false; code: "unavailable"; quote: CartQuote }
  | { ok: false; code: "stock_race"; productId: string }
  /** The order exists at `pending_payment`; the intent can be retried. */
  | { ok: false; code: "payment_setup_failed"; orderId: string; message: string };

function addressColumns(a: ShippingAddress) {
  return {
    shipName: a.name,
    shipLine1: a.line1,
    shipLine2: a.line2,
    shipCity: a.city,
    shipState: a.state,
    shipPostalCode: a.postalCode,
    shipCountry: a.country,
    shipPhone: a.phone,
  };
}

/** Three working days out, which is what the demo fulfilment cadence hits. */
function estimatedDelivery(from = new Date()): string {
  const eta = new Date(from);
  eta.setUTCDate(eta.getUTCDate() + 3);
  eta.setUTCHours(22, 0, 0, 0);
  return eta.toISOString();
}

/**
 * Place an order.
 *
 * The order of operations is inverted from the version this replaces, and the
 * inversion is the whole design.
 *
 *   before:  authorize → capture → [tx: decrement stock, create order @ paid]
 *   after:   [tx: reclaim, decrement stock, create order @ pending_payment,
 *             create Payment row] → createIntent → customer confirms → webhook
 *
 * Before, money moved before the row existed, so a crash in the window between
 * capture and commit left a real charge with no order, no payment row, and no
 * trace anywhere — recoverable only by reading Stripe's dashboard against our
 * database by hand. Now the row exists first and money is something that
 * *happens to* it, which is also the only shape a real card payment can take:
 * the customer confirms in their own browser and the truth arrives on a webhook.
 *
 * `pending_payment` was dead code — the happy path skipped it — yet it already
 * had a TRANSITIONS entry, EVENT_COPY, and a place in CUSTOMER_CANCELLABLE.
 * It finally means what it always said.
 *
 * **Stock is reserved here, not at settlement.** Deferring the decrement to the
 * webhook would let two customers both be told "order placed" for the last unit
 * and both succeed, and refunding a successful charge for goods that do not
 * exist is worse for everyone than a fifteen-minute hold. The `gte` guard on
 * the conditional update is unchanged, so the oversell property is unchanged.
 */
export async function createOrder(
  userId: string,
  input: CreateOrderBody,
  db: PrismaClient = defaultPrisma
): Promise<CreateOrderResult> {
  if (input.items.length === 0) return { ok: false, code: "empty" };

  const quote = await quoteCart(input.items, { petId: input.petId, userId }, db);
  if (quote.problems.length > 0 || quote.lines.length === 0) {
    return { ok: false, code: "unavailable", quote };
  }

  const orderId = genId("o");
  const placedAt = nowIso();
  const provider = paymentProvider();

  try {
    await db.$transaction(
      async (tx) => {
        // Give back anything held by a checkout that was abandoned. Doing it
        // here rather than on a timer is deliberate: Vercel's Hobby plan fires
        // a cron at most once a day, so a fifteen-minute reaper cannot exist.
        // Reclaiming on demand makes the hold correct at the only moment it
        // matters — when someone else wants the stock.
        await releaseExpiredReservations(
          quote.lines.map((l) => l.productId),
          placedAt,
          tx
        );

        // Conditional decrement: the `gte` in the filter is the race guard. If
        // someone else took the last unit between the quote and here, this
        // matches zero rows and we bail out instead of overselling.
        for (const line of quote.lines) {
          const { count } = await tx.product.updateMany({
            where: { id: line.productId, stockQty: { gte: line.quantity } },
            data: { stockQty: { decrement: line.quantity } },
          });
          if (count === 0) throw new StockRaceError(line.productId);
        }

        const products = await tx.product.findMany({
          where: { id: { in: quote.lines.map((l) => l.productId) } },
        });
        const byId = new Map(products.map((p) => [p.id, p]));

        return tx.order.create({
          data: {
            id: orderId,
            userId,
            status: "pending_payment",
            paymentStatus: "unpaid",
            subtotalCents: quote.subtotalCents,
            shippingCents: quote.shippingCents,
            taxCents: quote.taxCents,
            totalCents: quote.totalCents,
            ...addressColumns(input.shippingAddress),
            deliveryInstructions: input.deliveryInstructions ?? "",
            placedAt,
            estimatedDeliveryAt: estimatedDelivery(new Date(placedAt)),
            reservationExpiresAt: reservationDeadline(placedAt),
            // Snapshotted: a membership that lapses next month must not rewrite
            // what this order cost.
            benefitsApplied: quote.shippingWaivedByMembership ? ["free_shipping"] : [],
            items: {
              create: quote.lines.map((line) => {
                const p = byId.get(line.productId)!;
                return {
                  productId: p.id,
                  name: p.name,
                  brand: p.brand,
                  imageUrl: p.imageUrl,
                  slug: p.slug,
                  unitPriceCents: line.unitPriceCents,
                  quantity: line.quantity,
                  lineTotalCents: line.lineTotalCents,
                };
              }),
            },
            events: {
              create: {
                status: "pending_payment",
                label: EVENT_COPY.pending_payment.label,
                description: EVENT_COPY.pending_payment.description,
                occurredAt: placedAt,
              },
            },
          },
          include: withRelations,
        });
      },
      // Raised from Prisma's 5s default. This transaction has been observed at
      // 5261ms under load against Neon, and it just gained a statement — a
      // checkout that fails because the database was briefly slow is a real
      // bug, not only a test flake.
      { timeout: 15_000, maxWait: 10_000 }
    );
  } catch (e) {
    if (e instanceof StockRaceError) {
      return { ok: false, code: "stock_race", productId: e.productId };
    }
    throw e;
  }

  // From here the order exists. A failure below leaves it at `pending_payment`
  // with its stock held, which the customer can retry and the reaper will
  // eventually release — no money has moved, so there is nothing to compensate.
  try {
    const customerRef = await db.user
      .findUnique({ where: { id: userId }, select: { stripeCustomerId: true } })
      .then((u) => u?.stripeCustomerId ?? null);

    const intent = await provider.createIntent({
      amountCents: quote.totalCents,
      currency: "usd",
      orderId,
      userId,
      idempotencyKey: orderId,
      customerRef,
    });

    await createPaymentRow(
      {
        userId,
        kind: "order",
        orderId,
        provider: provider.name,
        providerRef: intent.ref,
        providerCustomerId: customerRef ?? "",
        amountCents: quote.totalCents,
        currency: intent.currency,
      },
      db
    );

    await db.order.update({
      where: { id: orderId },
      data: { paymentRef: intent.ref },
    });

    // A synchronous provider has already settled. It goes through exactly the
    // same reconciler the webhook uses — one path, so the demo cannot diverge
    // from production.
    if (!provider.asynchronous) {
      await applyIntentState(intent, { eventAt: nowIso() }, db);
      await settleOrderPayment(orderId, db);
    }

    const order = await getOrderById(orderId, db);
    return {
      ok: true,
      order: order!,
      payment: {
        ref: intent.ref,
        clientSecret: intent.clientSecret,
        provider: provider.name,
      },
    };
  } catch (e) {
    return {
      ok: false,
      code: "payment_setup_failed",
      orderId,
      message: e instanceof Error ? e.message : "Could not start the payment",
    };
  }
}

class StockRaceError extends Error {
  constructor(readonly productId: string) {
    super(`Stock ran out for ${productId}`);
    this.name = "StockRaceError";
  }
}

/**
 * Move an order to `paid` once its payment has actually succeeded.
 *
 * Called from three places — the webhook, the inline settle above, and the
 * confirmation page's sync — and safe from all of them: an order already past
 * `pending_payment` is left alone rather than dragged backwards.
 */
export async function settleOrderPayment(
  orderId: string,
  db: PrismaClient = defaultPrisma
): Promise<OrderStatusResult | { ok: false; code: "not_paid" }> {
  const payment = await currentPaymentForOrder(orderId, db);
  if (!payment || payment.status !== "paid") return { ok: false, code: "not_paid" };

  await db.order.update({
    where: { id: orderId },
    data: {
      paymentStatus: "paid",
      // The hold has done its job; the goods are sold.
      reservationExpiresAt: null,
    },
  });

  return updateOrderStatus(orderId, "paid", {}, db);
}

/* ── Fulfilment ──────────────────────────────────────────────────────── */

export type OrderStatusResult =
  | { ok: true; order: ReturnType<typeof toOrder> }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid_transition"; from: OrderStatus; to: OrderStatus }
  /** Someone else moved this order while we were deciding. */
  | { ok: false; code: "concurrent_change"; from: OrderStatus };

/**
 * Statuses after which the goods have left the building.
 *
 * Restocking on the way out of these would credit inventory for items sitting
 * in the customer's house — and `delivered → refunded` is a legal transition,
 * so this was reachable, not theoretical. A physical return is a separate
 * event, and the `restock` option is how it says so.
 */
const SHIPPED_OUT: OrderStatus[] = ["shipped", "out_for_delivery", "delivered"];

/**
 * Advance an order and append the matching timeline event.
 *
 * Three things changed here beyond the concurrency guard, all of them money
 * bugs rather than tidying:
 *
 *  1. **This no longer calls the payment provider.** It used to issue a refund
 *     *after* the transaction committed, with no compensation — and since
 *     `refunded` is terminal, a provider failure left the database claiming
 *     refunded with no supported path to try again. Refunds now go through
 *     `requestRefund`, which writes a retryable row before it calls anyone.
 *  2. **Cancelling a paid order refunds it.** It used to restock the items and
 *     set `cancelled` while leaving `paymentStatus: "paid"` — the customer's
 *     money simply stayed with us.
 *  3. **Restocking only happens if the goods never shipped.**
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  options: {
    location?: string;
    carrier?: string;
    trackingNumber?: string;
    occurredAt?: string;
    /** Force a restock — a physical return that has actually come back. */
    restock?: boolean;
    /** Who asked, for the refund ledger. A staff id, or "system". */
    initiatedBy?: string;
  } = {},
  db: PrismaClient = defaultPrisma
): Promise<OrderStatusResult> {
  const existing = await db.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!existing) return { ok: false, code: "not_found" };

  const from = existing.status as OrderStatus;
  if (from === status) {
    const unchanged = await getOrderById(id, db);
    return { ok: true, order: unchanged! };
  }
  if (!TRANSITIONS[from].includes(status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }

  const occurredAt = options.occurredAt ?? nowIso();
  const leaving = status === "cancelled" || status === "refunded";
  const restocking = options.restock ?? (leaving && !SHIPPED_OUT.includes(from));

  let raced = false;
  const updated = await db.$transaction(async (tx) => {
    // Conditional on the status we read. There are three writers now — the ops
    // console, the fulfilment cron, and the payment webhook — and a
    // read-then-write with no guard lets two of them both pass the transition
    // check and both apply.
    const { count } = await tx.order.updateMany({
      where: { id, status: from },
      data: {
        status,
        ...(options.carrier ? { carrier: options.carrier } : {}),
        ...(options.trackingNumber ? { trackingNumber: options.trackingNumber } : {}),
        ...(status === "delivered" ? { deliveredAt: occurredAt } : {}),
      },
    });
    if (count === 0) {
      raced = true;
      return null;
    }

    if (restocking) {
      for (const item of existing.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { increment: item.quantity } },
        });
      }
    }

    await tx.orderEvent.create({
      data: {
        orderId: id,
        status,
        label: EVENT_COPY[status].label,
        description: EVENT_COPY[status].description,
        location: options.location ?? null,
        occurredAt,
      },
    });

    return tx.order.findUnique({ where: { id }, include: withRelations });
  });

  if (raced || !updated) return { ok: false, code: "concurrent_change", from };

  // Money going back. Outside the transaction because it is a network call to a
  // third party, and safe there because `requestRefund` records its intent
  // before it makes that call — a crash leaves a pending row to retry rather
  // than a refund nobody knows was owed.
  let refunded = false;
  if (leaving) {
    const payment = await currentPaymentForOrder(id, db);
    if (payment && ["paid", "partially_refunded", "authorized"].includes(payment.status)) {
      const result = await requestRefund(
        {
          paymentId: payment.id,
          reason: status === "cancelled" ? "order_cancelled" : "requested_by_customer",
          initiatedBy: options.initiatedBy ?? "system",
        },
        db
      );
      refunded = result.ok;
    }
  }

  // Only the milestones worth interrupting someone for. Picking and packing
  // happen in a warehouse and nobody wants a notification about either.
  const told = DELIVERY_NOTICES[status];
  if (told) await notify(existing.userId, { ...told, href: `/store/orders/${id}` }, db);

  // Re-read when a refund settled. `updated` was captured inside the
  // transaction, before the provider was called, so its `paymentStatus` predates
  // the refund — returning it would hand the caller a row that says "paid"
  // about money that has already gone back.
  if (refunded) {
    const fresh = await getOrderById(id, db);
    if (fresh) return { ok: true, order: fresh };
  }

  return { ok: true, order: toOrder(updated) };
}
