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
    where: { status: { notIn: ["delivered", "cancelled", "refunded"] } },
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
  petId?: string,
  db: PrismaClient = defaultPrisma
): Promise<CartQuote> {
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
  // Nothing in the basket costs nothing to ship. Without this an empty cart
  // quotes the flat shipping rate, which is what the cart screen would show.
  const empty = quoted.length === 0;
  const shippingCents = empty ? 0 : shippingFor(subtotalCents);
  const taxCents = empty ? 0 : taxFor(subtotalCents);

  return {
    lines: quoted,
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents: subtotalCents + shippingCents + taxCents,
    problems,
  };
}

/* ── Checkout ────────────────────────────────────────────────────────── */

export type CreateOrderResult =
  | { ok: true; order: ReturnType<typeof toOrder> }
  | { ok: false; code: "empty" }
  | { ok: false; code: "unavailable"; quote: CartQuote }
  | { ok: false; code: "stock_race"; productId: string };

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

export async function createOrder(
  userId: string,
  input: CreateOrderBody,
  db: PrismaClient = defaultPrisma
): Promise<CreateOrderResult> {
  if (input.items.length === 0) return { ok: false, code: "empty" };

  const quote = await quoteCart(input.items, input.petId, db);
  if (quote.problems.length > 0 || quote.lines.length === 0) {
    return { ok: false, code: "unavailable", quote };
  }

  const orderId = genId("o");
  const placedAt = nowIso();

  // Payment is taken before the transaction opens: a provider call is a network
  // round trip to a third party, and holding row locks across one is how
  // checkout deadlocks under load. If the transaction below fails we refund.
  const provider = paymentProvider();
  const authorization = await provider.authorize(quote.totalCents, { orderId });
  const captured = await provider.capture(authorization.ref);

  try {
    const created = await db.$transaction(async (tx) => {
      // Conditional decrement: the `gte` in the filter is the race guard. If
      // someone else took the last unit between the quote and here, this
      // matches zero rows and we bail out instead of overselling.
      for (const line of quote.lines) {
        const { count } = await tx.product.updateMany({
          where: { id: line.productId, stockQty: { gte: line.quantity } },
          data: { stockQty: { decrement: line.quantity } },
        });
        if (count === 0) {
          throw new StockRaceError(line.productId);
        }
      }

      const products = await tx.product.findMany({
        where: { id: { in: quote.lines.map((l) => l.productId) } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      return tx.order.create({
        data: {
          id: orderId,
          userId,
          status: "paid",
          paymentStatus: captured.status,
          paymentRef: captured.ref,
          subtotalCents: quote.subtotalCents,
          shippingCents: quote.shippingCents,
          taxCents: quote.taxCents,
          totalCents: quote.totalCents,
          ...addressColumns(input.shippingAddress),
          deliveryInstructions: input.deliveryInstructions ?? "",
          placedAt,
          estimatedDeliveryAt: estimatedDelivery(new Date(placedAt)),
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
              status: "paid",
              label: EVENT_COPY.paid.label,
              description: EVENT_COPY.paid.description,
              occurredAt: placedAt,
            },
          },
        },
        include: withRelations,
      });
    });

    return { ok: true, order: toOrder(created) };
  } catch (e) {
    // The customer's money is already captured, so an aborted order must give
    // it back rather than leave them paid-for-nothing.
    await provider.refund(captured.ref, quote.totalCents);
    if (e instanceof StockRaceError) {
      return { ok: false, code: "stock_race", productId: e.productId };
    }
    throw e;
  }
}

class StockRaceError extends Error {
  constructor(readonly productId: string) {
    super(`Stock ran out for ${productId}`);
    this.name = "StockRaceError";
  }
}

/* ── Fulfilment ──────────────────────────────────────────────────────── */

export type OrderStatusResult =
  | { ok: true; order: ReturnType<typeof toOrder> }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid_transition"; from: OrderStatus; to: OrderStatus };

/**
 * Advance an order and append the matching timeline event.
 *
 * Cancelling or refunding returns the stock, which is why this is a
 * transaction rather than a bare update.
 */
export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  options: {
    location?: string;
    carrier?: string;
    trackingNumber?: string;
    occurredAt?: string;
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
  const restocking = status === "cancelled" || status === "refunded";

  const updated = await db.$transaction(async (tx) => {
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

    return tx.order.update({
      where: { id },
      data: {
        status,
        ...(options.carrier ? { carrier: options.carrier } : {}),
        ...(options.trackingNumber ? { trackingNumber: options.trackingNumber } : {}),
        ...(status === "delivered" ? { deliveredAt: occurredAt } : {}),
        ...(status === "refunded" ? { paymentStatus: "refunded" } : {}),
      },
      include: withRelations,
    });
  });

  if (status === "refunded" && existing.paymentRef) {
    await paymentProvider().refund(existing.paymentRef, existing.totalCents);
  }

  // Only the milestones worth interrupting someone for. Picking and packing
  // happen in a warehouse and nobody wants a notification about either.
  const told = DELIVERY_NOTICES[status];
  if (told) await notify(existing.userId, { ...told, href: `/store/orders/${id}` }, db);

  return { ok: true, order: toOrder(updated) };
}
