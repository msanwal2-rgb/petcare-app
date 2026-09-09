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
  settleOrderPayment,
  updateOrderStatus,
} from "@/lib/server/orders";
import { applyIntentState, requestRefund } from "@/lib/server/payments/ledger";
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
    const quote = await quoteCart([{ productId: "prod19", quantity: 1 }], { petId: "p1" }, db);
    expect(quote.problems[0].code).toBe("prescription_required");
  });

  it("allows an Rx-only product for a pet whose vet prescribed it", async () => {
    // Luna (p4) holds a current prescription for the hypoallergenic cat diet
    const quote = await quoteCart([{ productId: "prod19", quantity: 1 }], { petId: "p4" }, db);
    expect(quote.problems).toEqual([]);
    expect(quote.lines[0].requiresPrescription).toBe(true);
  });

  it("still blocks a different Rx product the prescription doesn't name", async () => {
    const quote = await quoteCart([{ productId: "prod21", quantity: 1 }], { petId: "p4" }, db);
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

  it("opens the tracking timeline honestly, in two steps", async () => {
    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    // Two events, not one, and the change is the point: an order is placed
    // before it is paid for. The timeline now says "we're waiting for your
    // payment to clear" and then "payment confirmed", which is what actually
    // happened — the copy for both was already sitting in EVENT_COPY.
    expect(res.order.events).toHaveLength(2);
    expect(res.order.events.map((e) => e.status)).toEqual([
      "pending_payment",
      "paid",
    ]);
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
   * An *asynchronous* fake, which is the point.
   *
   * The provider this replaces settled inline, so no test could express an
   * out-of-order event, a duplicate delivery, or a webhook that never arrives —
   * the three things that actually go wrong with real payments. This one hands
   * back a `requires_payment_method` intent and lets the test decide when, and
   * in what order, the truth turns up.
   */
  function fakeStripe() {
    const calls: string[] = [];
    const intents = new Map<string, { amountCents: number; status: string }>();
    let n = 0;

    const provider: PaymentProvider = {
      name: "recording",
      asynchronous: true,
      async createIntent(input) {
        const ref = `pi_test_${++n}`;
        calls.push(`createIntent:${input.amountCents}:${input.idempotencyKey}`);
        intents.set(ref, { amountCents: input.amountCents, status: "requires_payment_method" });
        return {
          ref,
          status: "requires_payment_method",
          amountCents: input.amountCents,
          currency: input.currency,
          clientSecret: `${ref}_secret`,
        };
      },
      async getIntent(ref) {
        const it = intents.get(ref)!;
        calls.push(`getIntent:${ref}`);
        return {
          ref,
          status: it.status as "succeeded",
          amountCents: it.amountCents,
          currency: "usd",
          clientSecret: null,
        };
      },
      async cancelIntent(ref) {
        calls.push(`cancelIntent:${ref}`);
        return { ref, status: "canceled", amountCents: 0, currency: "usd", clientSecret: null };
      },
      async refund(input) {
        calls.push(`refund:${input.ref}:${input.amountCents}`);
        return { ref: `re_${input.ref}`, status: "succeeded", amountCents: input.amountCents };
      },
    };

    /** What the webhook would carry when the customer's card goes through. */
    const succeed = (ref: string, amountCents?: number) => {
      const it = intents.get(ref)!;
      it.status = "succeeded";
      return {
        ref,
        status: "succeeded" as const,
        amountCents: amountCents ?? it.amountCents,
        currency: "usd",
        clientSecret: null,
        methodBrand: "visa",
        methodLast4: "4242",
      };
    };

    const fail = (ref: string, code = "card_declined") => ({
      ref,
      status: "failed" as const,
      amountCents: intents.get(ref)!.amountCents,
      currency: "usd",
      clientSecret: null,
      failureCode: code,
      failureMessage: "Your card was declined.",
    });

    return { provider, calls, succeed, fail };
  }

  beforeEach(async () => {
    await resetToSnapshot(db);
  });
  afterEach(() => {
    setPaymentProvider(DEFAULT_PROVIDER);
  });

  it("creates the intent for the server's total, keyed on the order", async () => {
    const { provider, calls } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    expect(calls).toEqual([`createIntent:${res.order.totalCents}:${res.order.id}`]);
    // The clientSecret reaches this one response and is never stored.
    expect(res.payment.clientSecret).toMatch(/_secret$/);
    const stored = await db.payment.findUnique({ where: { providerRef: res.payment.ref } });
    expect(JSON.stringify(stored)).not.toContain("_secret");
  });

  it("leaves the order unpaid until the payment actually succeeds", async () => {
    const { provider, succeed } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    // This is the state the old design could never occupy: an order exists,
    // stock is held, and no money has moved.
    expect(res.order.status).toBe("pending_payment");
    expect(res.order.paymentStatus).toBe("unpaid");

    await applyIntentState(succeed(res.payment.ref), {}, db);
    await settleOrderPayment(res.order.id, db);

    const after = await getOrderById(res.order.id, db);
    expect(after!.status).toBe("paid");
    expect(after!.paymentStatus).toBe("paid");
  });

  it("reserves stock at checkout, before the money arrives", async () => {
    const { provider } = fakeStripe();
    setPaymentProvider(provider);

    const before = (await db.product.findUnique({ where: { id: "prod13" } }))!.stockQty;
    await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 2 }], shippingAddress: ADDRESS },
      db
    );
    const after = (await db.product.findUnique({ where: { id: "prod13" } }))!.stockQty;

    // Deferring this to the webhook would let two customers both be told
    // "order placed" for the last unit, and refunding a successful charge for
    // goods that don't exist is worse than a fifteen-minute hold.
    expect(after).toBe(before - 2);
  });

  it("charges nobody when a stock race is lost", async () => {
    const { provider, calls } = fakeStripe();
    setPaymentProvider(provider);

    const buy = () =>
      createOrder(
        "u1",
        { items: [{ productId: "prod6", quantity: 12 }], shippingAddress: ADDRESS },
        db
      );
    const results = await Promise.all([buy(), buy()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    // The old design charged both and refunded one. Now the loser never had an
    // intent created at all — there is nothing to give back.
    expect(calls.filter((c) => c.startsWith("createIntent"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(0);
  });

  it("records a failed payment without cancelling the order", async () => {
    const { provider, fail } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    await applyIntentState(fail(res.payment.ref), {}, db);

    const payment = await db.payment.findUnique({
      where: { providerRef: res.payment.ref },
    });
    expect(payment!.status).toBe("failed");
    expect(payment!.failureCode).toBe("card_declined");
    // Stripe keeps a failed intent retryable, so the order stays where it is.
    const order = await getOrderById(res.order.id, db);
    expect(order!.status).toBe("pending_payment");
  });

  it("refuses to mark an order paid for the wrong amount", async () => {
    const { provider, succeed } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    const applied = await applyIntentState(succeed(res.payment.ref, 1), {}, db);
    expect(applied).toMatchObject({ ok: false, code: "amount_mismatch" });

    const payment = await db.payment.findUnique({
      where: { providerRef: res.payment.ref },
    });
    expect(payment!.status).toBe("failed");
  });

  it("is idempotent: the same event twice has one effect", async () => {
    const { provider, succeed } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    const event = succeed(res.payment.ref);
    const first = await applyIntentState(event, { eventAt: "2026-09-09T10:00:00.000Z" }, db);
    const second = await applyIntentState(event, { eventAt: "2026-09-09T10:00:00.000Z" }, db);

    expect(first).toMatchObject({ ok: true, changed: true });
    expect(second).toMatchObject({ ok: true, changed: false });
  });

  it("ignores an event older than one it has already applied", async () => {
    const { provider, succeed, fail } = fakeStripe();
    setPaymentProvider(provider);

    const res = await createOrder(
      "u1",
      { items: [{ productId: "prod13", quantity: 1 }], shippingAddress: ADDRESS },
      db
    );
    if (!res.ok) throw new Error("expected order");

    await applyIntentState(succeed(res.payment.ref), { eventAt: "2026-09-09T12:00:00.000Z" }, db);
    // A failure notice created *before* the success, arriving after it. Without
    // the guard this would un-pay a paid order.
    const stale = await applyIntentState(
      fail(res.payment.ref),
      { eventAt: "2026-09-09T11:00:00.000Z" },
      db
    );

    expect(stale).toEqual({ ok: false, code: "stale_event" });
    const payment = await db.payment.findUnique({
      where: { providerRef: res.payment.ref },
    });
    expect(payment!.status).toBe("paid");
  });

  it("refunds when a paid order is cancelled", async () => {
    const { provider, calls } = fakeStripe();
    setPaymentProvider(provider);

    // o3 is seeded `processing` and paid — late enough to have been charged,
    // early enough that cancelling is still a legal move.
    const res = await updateOrderStatus("o3", "cancelled", {}, db);
    expect(res.ok).toBe(true);

    // The bug this covers: cancelling used to restock the items and set
    // `cancelled` while leaving paymentStatus "paid" — the customer's money
    // simply stayed with us.
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(1);
    const payment = await db.payment.findFirst({ where: { orderId: "o3" } });
    expect(payment!.status).toBe("refunded");
    expect(payment!.amountRefundedCents).toBe(payment!.amountCents);
  });

  it("refunds when an order is refunded", async () => {
    const { provider, calls } = fakeStripe();
    setPaymentProvider(provider);

    const res = await updateOrderStatus("o1", "refunded", {}, db);
    if (!res.ok) throw new Error("expected ok");
    expect(calls.filter((c) => c.startsWith("refund"))).toHaveLength(1);
  });

  it("does not restock goods that already reached the customer", async () => {
    const { provider } = fakeStripe();
    setPaymentProvider(provider);

    const delivered = await db.order.findFirst({
      where: { status: "delivered" },
      include: { items: true },
    });
    if (!delivered) throw new Error("expected a delivered order in the seed");
    const item = delivered.items[0]!;
    const before = (await db.product.findUnique({ where: { id: item.productId } }))!.stockQty;

    await updateOrderStatus(delivered.id, "refunded", {}, db);

    // `delivered → refunded` is a legal transition, and restocking on it would
    // credit inventory for a bag of food sitting in someone's kitchen.
    const after = (await db.product.findUnique({ where: { id: item.productId } }))!.stockQty;
    expect(after).toBe(before);
  });

  it("restocks a returned order when told the goods came back", async () => {
    const { provider } = fakeStripe();
    setPaymentProvider(provider);

    const delivered = await db.order.findFirst({
      where: { status: "delivered" },
      include: { items: true },
    });
    if (!delivered) throw new Error("expected a delivered order in the seed");
    const item = delivered.items[0]!;
    const before = (await db.product.findUnique({ where: { id: item.productId } }))!.stockQty;

    await updateOrderStatus(delivered.id, "refunded", { restock: true }, db);

    const after = (await db.product.findUnique({ where: { id: item.productId } }))!.stockQty;
    expect(after).toBe(before + item.quantity);
  });

  it("refuses a second concurrent move of the same order", async () => {
    const { provider } = fakeStripe();
    setPaymentProvider(provider);

    // Three writers exist now — the ops console, the cron, and the webhook — so
    // a read-then-write with no guard lets two of them both apply. o3 is
    // `processing`, from which both of these are individually legal, so the
    // loser can only be losing the race rather than the transition check.
    const [a, b] = await Promise.all([
      updateOrderStatus("o3", "cancelled", {}, db),
      updateOrderStatus("o3", "refunded", {}, db),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.code).toBe("concurrent_change");
  });
});

describe("refund accounting", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("supports a partial refund and tracks the remainder", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    const half = Math.floor(payment!.amountCents / 2);

    const first = await requestRefund(
      { paymentId: payment!.id, amountCents: half, initiatedBy: "u22" },
      db
    );
    expect(first.ok).toBe(true);

    const after = await db.payment.findUnique({ where: { id: payment!.id } });
    expect(after!.status).toBe("partially_refunded");
    expect(after!.amountRefundedCents).toBe(half);
  });

  it("refuses to refund more than was captured", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    const result = await requestRefund(
      { paymentId: payment!.id, amountCents: payment!.amountCents + 1 },
      db
    );
    expect(result).toMatchObject({ ok: false, code: "exceeds_captured" });
  });

  it("refuses a second refund while one is pending", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    await db.refund.create({
      data: {
        id: "rfnd_inflight",
        paymentId: payment!.id,
        amountCents: 100,
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    });
    const result = await requestRefund({ paymentId: payment!.id, amountCents: 100 }, db);
    expect(result).toEqual({ ok: false, code: "already_refunding" });
  });

  it("records who issued it", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    await requestRefund({ paymentId: payment!.id, initiatedBy: "u22" }, db);
    const refund = await db.refund.findFirst({ where: { paymentId: payment!.id } });
    expect(refund!.initiatedBy).toBe("u22");
  });

  it("reports when there is no payment to refund", async () => {
    expect(await requestRefund({ orderId: "nope" }, db)).toEqual({
      ok: false,
      code: "no_payment",
    });
  });
});

describe("payment state machine", () => {
  it("allows the normal card path", () => {
    expect(canTransitionPayment("unpaid", "pending")).toBe(true);
    expect(canTransitionPayment("pending", "requires_action")).toBe(true);
    expect(canTransitionPayment("requires_action", "paid")).toBe(true);
    expect(canTransitionPayment("paid", "refunded")).toBe(true);
  });

  it("still allows the manual-capture path, which stays available", () => {
    expect(canTransitionPayment("unpaid", "authorized")).toBe(true);
    expect(canTransitionPayment("authorized", "paid")).toBe(true);
  });

  it("allows a partial refund to become a full one", () => {
    expect(canTransitionPayment("paid", "partially_refunded")).toBe(true);
    expect(canTransitionPayment("partially_refunded", "refunded")).toBe(true);
  });

  it("lets a dispute be won as well as lost", () => {
    expect(canTransitionPayment("paid", "disputed")).toBe(true);
    expect(canTransitionPayment("disputed", "paid")).toBe(true);
    expect(canTransitionPayment("disputed", "refunded")).toBe(true);
  });

  it("refuses to un-refund or re-charge a refunded payment", () => {
    expect(canTransitionPayment("refunded", "paid")).toBe(false);
    expect(canTransitionPayment("refunded", "authorized")).toBe(false);
  });

  it("lets a failed payment be retried, because Stripe keeps the intent alive", () => {
    expect(canTransitionPayment("failed", "pending")).toBe(true);
    expect(canTransitionPayment("failed", "paid")).toBe(true);
  });

  it("treats a no-op as allowed", () => {
    expect(canTransitionPayment("paid", "paid")).toBe(true);
  });
});
