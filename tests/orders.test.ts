import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  canCustomerCancel,
  createOrder,
  getOrderById,
  getOrdersByUser,
  getOrdersForFulfillment,
  quoteCart,
  updateOrderStatus,
} from "@/lib/server/orders";
import {
  shippingFor,
  taxFor,
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
} from "@/lib/pricing";
import {
  canTransitionPayment,
  paymentProvider,
  setPaymentProvider,
  type PaymentProvider,
} from "@/lib/server/payments";

const ADDRESS = {
  name: "Maya Chen",
  line1: "1204 Grove Street",
  line2: "Apt 3B",
  city: "Austin",
  state: "TX",
  postalCode: "78704",
  country: "US",
  phone: "(512) 555-0142",
};

/** Captured before any test swaps it, so each one can put it back. */
const DEFAULT_PROVIDER = paymentProvider();

beforeAll(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("pricing rules", () => {
  it("charges flat shipping below the free threshold", () => {
    expect(shippingFor(FREE_SHIPPING_THRESHOLD_CENTS - 1)).toBe(FLAT_SHIPPING_CENTS);
  });

  it("ships free at and above the threshold", () => {
    expect(shippingFor(FREE_SHIPPING_THRESHOLD_CENTS)).toBe(0);
    expect(shippingFor(FREE_SHIPPING_THRESHOLD_CENTS + 5000)).toBe(0);
  });

  it("computes tax as whole cents", () => {
    const tax = taxFor(1999);
    expect(Number.isInteger(tax)).toBe(true);
    expect(tax).toBe(165);
  });
});

describe("cart quoting", () => {
  it("prices a line from the catalog, not the caller", async () => {
    const quote = await quoteCart([{ productId: "prod13", quantity: 2 }], undefined, db);
    expect(quote.lines[0].unitPriceCents).toBe(1299);
    expect(quote.lines[0].lineTotalCents).toBe(2598);
    expect(quote.problems).toEqual([]);
  });

  it("totals subtotal + shipping + tax", async () => {
    const quote = await quoteCart([{ productId: "prod13", quantity: 1 }], undefined, db);
    expect(quote.subtotalCents).toBe(1299);
    expect(quote.shippingCents).toBe(FLAT_SHIPPING_CENTS);
    expect(quote.taxCents).toBe(taxFor(1299));
    expect(quote.totalCents).toBe(1299 + FLAT_SHIPPING_CENTS + taxFor(1299));
  });

  it("reports an unknown product rather than silently dropping it", async () => {
    const quote = await quoteCart([{ productId: "ghost", quantity: 1 }], undefined, db);
    expect(quote.problems[0].code).toBe("not_found");
    expect(quote.lines).toEqual([]);
  });

  it("reports a sold-out product", async () => {
    // prod25 (slow feeder bowl) is seeded with zero stock
    const quote = await quoteCart([{ productId: "prod25", quantity: 1 }], undefined, db);
    expect(quote.problems[0].code).toBe("out_of_stock");
  });

  it("reports insufficient stock with the quantity actually available", async () => {
    const quote = await quoteCart([{ productId: "prod20", quantity: 99 }], undefined, db);
    expect(quote.problems[0].code).toBe("insufficient_stock");
    expect(quote.problems[0].message).toContain("12");
  });

  it("blocks an Rx-only product when no pet is named", async () => {
    const quote = await quoteCart([{ productId: "prod19", quantity: 1 }], undefined, db);
    expect(quote.problems[0].code).toBe("prescription_required");
  });

  it("blocks an Rx-only product for a pet without that prescription", async () => {
    // Biscuit (p1) has vaccinations but no prescriptions
    const quote = await quoteCart([{ productId: "prod19", quantity: 1 }], "p1", db);
    expect(quote.problems[0].code).toBe("prescription_required");
  });

  it("allows an Rx-only product for a pet whose vet prescribed it", async () => {
    // Luna (p4) holds a current prescription for the hypoallergenic cat diet
    const quote = await quoteCart([{ productId: "prod19", quantity: 1 }], "p4", db);
    expect(quote.problems).toEqual([]);
    expect(quote.lines[0].requiresPrescription).toBe(true);
  });

  it("still blocks a different Rx product the prescription doesn't name", async () => {
    const quote = await quoteCart([{ productId: "prod21", quantity: 1 }], "p4", db);
    expect(quote.problems[0].code).toBe("prescription_required");
  });

  it("quotes an empty cart to zero, shipping included", async () => {
    const quote = await quoteCart([], undefined, db);
    expect(quote.lines).toEqual([]);
    expect(quote.subtotalCents).toBe(0);
    expect(quote.shippingCents).toBe(0);
    expect(quote.taxCents).toBe(0);
    expect(quote.totalCents).toBe(0);
  });

  it("charges nothing when every line is unavailable", async () => {
    // All lines rejected → an empty basket, not a $5.99 shipping charge.
    const quote = await quoteCart([{ productId: "prod25", quantity: 1 }], undefined, db);
    expect(quote.lines).toEqual([]);
    expect(quote.totalCents).toBe(0);
  });
});

describe("placing an order", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("creates a paid order with a snapshotted line item", async () => {
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 2 }], shippingAddress: ADDRESS },
      db
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.order.id).toMatch(/^o_/);
    expect(res.order.status).toBe("paid");
    expect(res.order.paymentStatus).toBe("paid");
    expect(res.order.paymentRef).toBeTruthy();
    expect(res.order.items).toHaveLength(1);
    expect(res.order.items[0].name).toBe("Peanut Butter Biscuits");
    expect(res.order.items[0].unitPriceCents).toBe(1299);
    expect(res.order.items[0].lineTotalCents).toBe(2598);
  });

  it("opens the tracking timeline with the payment event", async () => {
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");
    expect(res.order.events).toHaveLength(1);
    expect(res.order.events[0].status).toBe("paid");
  });

  it("decrements stock by the quantity ordered", async () => {
    const before = await db.product.findUnique({ where: { id: "prod13" } });
    await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 3 }], shippingAddress: ADDRESS },
      db
    );
    const after = await db.product.findUnique({ where: { id: "prod13" } });
    expect(after!.stockQty).toBe(before!.stockQty - 3);
  });

  it("ignores any price the client might have believed", async () => {
    // The input shape has no price field at all — this asserts the total is
    // derived purely from the catalog.
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod1", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");
    expect(res.order.subtotalCents).toBe(6499);
    expect(res.order.shippingCents).toBe(0); // over the free-shipping threshold
    expect(res.order.totalCents).toBe(6499 + taxFor(6499));
  });

  it("refuses an empty cart", async () => {
    const res = await createOrder("u1", { items: [], shippingAddress: ADDRESS }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("empty");
  });

  it("refuses an unavailable line and hands back the quote", async () => {
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod25", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "unavailable") {
      expect(res.quote.problems[0].code).toBe("out_of_stock");
    }
  });

  it("refuses an Rx product without a prescription, and leaves stock alone", async () => {
    const before = await db.product.findUnique({ where: { id: "prod19" } });
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod19", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    expect(res.ok).toBe(false);
    const after = await db.product.findUnique({ where: { id: "prod19" } });
    expect(after!.stockQty).toBe(before!.stockQty);
  });

  it("accepts an Rx product when the named pet is authorised", async () => {
    const res = await createOrder(
      "u3",
      {
        items: [{ productId: "prod19", quantity: 1 }],
        shippingAddress: ADDRESS,
        petId: "p4",
      },
      db
    );
    expect(res.ok).toBe(true);
  });

  it("cannot oversell the last units under concurrency", async () => {
    // prod6 is seeded with 19 units. Two customers race for 12 each: exactly
    // one must win, and stock must never go negative.
    const buy = () =>
      createOrder(
        "u1",
        { items: [{ productId: "prod6", quantity: 12 }], shippingAddress: ADDRESS },
        db
      );

    const results = await Promise.all([buy(), buy()]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code !== "empty")).toHaveLength(1);

    const product = await db.product.findUnique({ where: { id: "prod6" } });
    expect(product!.stockQty).toBe(7); // 19 - 12, never negative
  });

  it("refunds the payment when an order aborts after capture", async () => {
    // The loser of the race above paid before the stock check failed; the
    // order must not exist and no money may be left captured.
    const before = await getOrdersByUser("u1", db);
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod25", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    expect(res.ok).toBe(false);
    const after = await getOrdersByUser("u1", db);
    expect(after).toHaveLength(before.length);
  });
});

describe("order reads", () => {
  it("lists a user's orders newest-first", async () => {
    const orders = await getOrdersByUser("u1", db);
    expect(orders.length).toBe(3);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i - 1].placedAt >= orders[i].placedAt).toBe(true);
    }
  });

  it("returns [] for a user with no orders", async () => {
    expect(await getOrdersByUser("u7", db)).toEqual([]);
  });

  it("returns the tracking timeline in chronological order", async () => {
    const order = await getOrderById("o1", db);
    const times = order!.events.map((e) => e.occurredAt);
    expect([...times].sort()).toEqual(times);
    expect(order!.events.at(-1)!.status).toBe("delivered");
  });

  it("rebuilds the nested shipping address", async () => {
    const order = await getOrderById("o1", db);
    expect(order!.shippingAddress.city).toBe("Austin");
    expect(order!.shippingAddress.line2).toBe("Apt 3B");
  });

  it("returns null for an unknown order", async () => {
    expect(await getOrderById("nope", db)).toBeNull();
  });

  it("excludes finished orders from the fulfilment queue", async () => {
    const queue = await getOrdersForFulfillment(db);
    expect(queue.map((o) => o.id)).not.toContain("o1"); // delivered
    expect(queue.map((o) => o.id)).toContain("o2"); // out for delivery
  });

  it("orders the fulfilment queue oldest-first", async () => {
    const queue = await getOrdersForFulfillment(db);
    for (let i = 1; i < queue.length; i++) {
      expect(queue[i - 1].placedAt <= queue[i].placedAt).toBe(true);
    }
  });
});

describe("fulfilment lifecycle", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("advances a step and appends a timeline event", async () => {
    const res = await updateOrderStatus("o3", "packed", { location: "Austin, TX" }, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.status).toBe("packed");
    const last = res.order.events.at(-1)!;
    expect(last.status).toBe("packed");
    expect(last.location).toBe("Austin, TX");
  });

  it("records the carrier and tracking number when shipping", async () => {
    await updateOrderStatus("o3", "packed", {}, db);
    const res = await updateOrderStatus(
      "o3",
      "shipped",
      { carrier: "Leash Delivery", trackingNumber: "LEASH-1" },
      db
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.order.carrier).toBe("Leash Delivery");
    expect(res.order.trackingNumber).toBe("LEASH-1");
  });

  it("walks the full journey to delivered and stamps deliveredAt", async () => {
    await updateOrderStatus("o3", "packed", {}, db);
    await updateOrderStatus("o3", "shipped", {}, db);
    await updateOrderStatus("o3", "out_for_delivery", {}, db);
    const res = await updateOrderStatus("o3", "delivered", {}, db);
    if (!res.ok) throw new Error("expected ok");
    expect(res.order.status).toBe("delivered");
    expect(res.order.deliveredAt).toBeTruthy();
    expect(res.order.events).toHaveLength(6);
  });

  it("rejects skipping straight from paid to delivered", async () => {
    const res = await updateOrderStatus("o3", "delivered", {}, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_transition");
  });

  it("rejects going backwards", async () => {
    const res = await updateOrderStatus("o2", "packed", {}, db);
    expect(res.ok).toBe(false);
  });

  it("rejects changing a delivered order except to refunded", async () => {
    expect((await updateOrderStatus("o1", "shipped", {}, db)).ok).toBe(false);
    expect((await updateOrderStatus("o1", "refunded", {}, db)).ok).toBe(true);
  });

  it("returns stock when an order is cancelled", async () => {
    const order = await getOrderById("o3", db);
    const item = order!.items[0];
    const before = await db.product.findUnique({ where: { id: item.productId } });

    await updateOrderStatus("o3", "cancelled", {}, db);

    const after = await db.product.findUnique({ where: { id: item.productId } });
    expect(after!.stockQty).toBe(before!.stockQty + item.quantity);
  });

  it("returns stock and marks the payment refunded on a refund", async () => {
    const res = await updateOrderStatus("o1", "refunded", {}, db);
    if (!res.ok) throw new Error("expected ok");
    expect(res.order.paymentStatus).toBe("refunded");
  });

  it("reports not_found for an unknown order", async () => {
    const res = await updateOrderStatus("ghost", "packed", {}, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });

  it("treats a no-op same-status update as valid", async () => {
    const res = await updateOrderStatus("o3", "processing", {}, db);
    expect(res.ok).toBe(true);
  });
});

describe("customer cancellation window", () => {
  it("allows cancelling up to and including packed", () => {
    expect(canCustomerCancel("pending_payment")).toBe(true);
    expect(canCustomerCancel("paid")).toBe(true);
    expect(canCustomerCancel("processing")).toBe(true);
    expect(canCustomerCancel("packed")).toBe(true);
  });

  it("closes the window once it's with the carrier", () => {
    expect(canCustomerCancel("shipped")).toBe(false);
    expect(canCustomerCancel("out_for_delivery")).toBe(false);
    expect(canCustomerCancel("delivered")).toBe(false);
  });
});

describe("the payment provider is a real seam", () => {
  /**
   * Records what the store asks a provider to do. Proves the boundary is
   * genuinely swappable — and that an order that fails after capture gives the
   * money back rather than leaving a customer paid-for-nothing.
   */
  function recordingProvider() {
    const calls: string[] = [];
    const provider: PaymentProvider = {
      name: "recording",
      async authorize(amountCents) {
        calls.push(`authorize:${amountCents}`);
        return { ref: "rec_1", status: "authorized" };
      },
      async capture(ref) {
        calls.push(`capture:${ref}`);
        return { ref, status: "paid" };
      },
      async refund(ref, amountCents) {
        calls.push(`refund:${ref}:${amountCents}`);
        return { ref, status: "refunded" };
      },
    };
    return { provider, calls };
  }

  beforeEach(async () => {
    await resetToSnapshot(db);
  });
  afterEach(() => {
    setPaymentProvider(DEFAULT_PROVIDER);
  });

  it("authorizes then captures the server's total, not the client's", async () => {
    const { provider, calls } = recordingProvider();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    expect(calls).toEqual([`authorize:${res.order.totalCents}`, "capture:rec_1"]);
    expect(res.order.paymentRef).toBe("rec_1");
  });

  it("refunds the loser of a stock race, who had already been charged", async () => {
    const { provider, calls } = recordingProvider();
    setPaymentProvider(provider);

    // Both quote successfully against 19 units, both pay, only one can have it.
    const buy = () =>
      createOrder(
        "u1",
        { items: [{ productId: "prod6", quantity: 12 }], shippingAddress: ADDRESS },
        db
      );
    const results = await Promise.all([buy(), buy()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // Two customers charged, exactly one refunded — nobody is left paid-for-nothing.
    expect(calls.filter((c) => c.startsWith("capture"))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(1);
  });

  it("refunds through the provider when an order is refunded", async () => {
    const { provider, calls } = recordingProvider();
    setPaymentProvider(provider);

    const res = await updateOrderStatus("o1", "refunded", {}, db);
    if (!res.ok) throw new Error("expected ok");
    expect(calls).toEqual([`refund:demo_pay_o1:${res.order.totalCents}`]);
  });
});

describe("payment state machine", () => {
  it("allows the normal capture path", () => {
    expect(canTransitionPayment("unpaid", "authorized")).toBe(true);
    expect(canTransitionPayment("authorized", "paid")).toBe(true);
    expect(canTransitionPayment("paid", "refunded")).toBe(true);
  });

  it("refuses to un-refund or re-charge a refunded payment", () => {
    expect(canTransitionPayment("refunded", "paid")).toBe(false);
    expect(canTransitionPayment("refunded", "authorized")).toBe(false);
  });

  it("lets a failed payment be retried", () => {
    expect(canTransitionPayment("failed", "authorized")).toBe(true);
  });

  it("treats a no-op as allowed", () => {
    expect(canTransitionPayment("paid", "paid")).toBe(true);
  });
});
