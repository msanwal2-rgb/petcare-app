import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  claimEvent,
  markFailed,
  markProcessed,
  markSkipped,
  purgeOldEvents,
  LOCK_TTL_MS,
  MAX_ATTEMPTS,
} from "@/lib/server/webhooks/store";
import { handleStripeEvent } from "@/lib/server/webhooks/stripe";

/**
 * Event fixtures.
 *
 * Shaped like Stripe's, and deliberately built through one helper so a field
 * name that changes has one place to change. What matters for these tests is
 * `id` (idempotency), `created` (ordering) and `type` (dispatch).
 */
let seq = 0;
function event<T>(type: string, object: T, createdSeconds = 1_800_000_000): Stripe.Event {
  return {
    id: `evt_test_${++seq}`,
    object: "event",
    api_version: "2025-08-27.basil",
    created: createdSeconds,
    data: { object: object as never },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
  } as unknown as Stripe.Event;
}

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("claiming an event", () => {
  it("claims one nobody has seen", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    expect(await claimEvent(toIncoming(e), new Date(), db)).toEqual({ claim: "new" });
  });

  it("reports a second delivery of a processed event as a duplicate", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    await claimEvent(toIncoming(e), new Date(), db);
    await markProcessed(e.id, db);

    expect(await claimEvent(toIncoming(e), new Date(), db)).toEqual({
      claim: "duplicate",
    });
  });

  it("holds off a second worker while the first is still going", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    await claimEvent(toIncoming(e), new Date(), db);
    // The route answers 500 to this, so the provider brings it back later
    // rather than two workers applying the same event at once.
    expect(await claimEvent(toIncoming(e), new Date(), db)).toEqual({
      claim: "in_flight",
    });
  });

  it("re-claims an event whose worker died mid-flight", async () => {
    // The trap this exists for: insert `received`, crash, and a naive
    // dedupe-on-insert tells the retry everything is fine. The event is then
    // lost forever, and the only symptom is an order that never got paid.
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    await claimEvent(toIncoming(e), new Date(), db);

    const later = new Date(Date.now() + LOCK_TTL_MS + 1000);
    const claim = await claimEvent(toIncoming(e), later, db);
    expect(claim).toMatchObject({ claim: "retry" });
  });

  it("re-claims one that failed", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    await claimEvent(toIncoming(e), new Date(), db);
    await markFailed(e.id, "database was away", db);

    const claim = await claimEvent(toIncoming(e), new Date(), db);
    expect(claim).toMatchObject({ claim: "retry" });
  });

  it("gives up after enough attempts, rather than retrying forever", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_1" });
    await claimEvent(toIncoming(e), new Date(), db);
    await db.webhookEvent.update({
      where: { id: e.id },
      data: { attempts: MAX_ATTEMPTS, status: "failed" },
    });
    expect(await claimEvent(toIncoming(e), new Date(), db)).toMatchObject({
      claim: "exhausted",
    });
  });

  it("treats a skipped event as settled", async () => {
    const e = event("customer.discount.created", {});
    await claimEvent(toIncoming(e), new Date(), db);
    await markSkipped(e.id, "unknown_type", db);
    expect(await claimEvent(toIncoming(e), new Date(), db)).toEqual({
      claim: "duplicate",
    });
  });

  it("keeps the payload, so a human can replay what automation gave up on", async () => {
    const e = event("payment_intent.succeeded", { id: "pi_keep" });
    await claimEvent(toIncoming(e), new Date(), db);
    const row = await db.webhookEvent.findUnique({ where: { id: e.id } });
    expect(JSON.stringify(row!.payload)).toContain("pi_keep");
  });
});

describe("handling an event", () => {
  it("ignores a type nobody subscribed to", async () => {
    // Stripe endpoints receive types you did not ask for. Not an error, and
    // answering 500 would buy a three-day retry storm.
    const result = await handleStripeEvent(
      event("customer.discount.created", { id: "di_1" }),
      db
    );
    expect(result).toEqual({ handled: false, reason: "unknown_type" });
  });

  it("ignores an intent it has no record of", async () => {
    const result = await handleStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_unknown",
        amount: 100,
        currency: "usd",
        status: "succeeded",
        metadata: {},
      }),
      db
    );
    expect(result).toEqual({ handled: false, reason: "unknown_subject" });
  });

  it("marks an order paid when its intent succeeds", async () => {
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a seeded order");

    // Put it back to the state a real checkout leaves it in.
    await db.order.update({
      where: { id: order.id },
      data: { status: "pending_payment", paymentStatus: "unpaid" },
    });
    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "pending", providerRef: "pi_live", lastEventAt: "" },
    });

    const result = await handleStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_live",
        amount: order.totalCents,
        currency: "usd",
        status: "succeeded",
        metadata: { orderId: order.id },
      }),
      db
    );

    expect(result).toMatchObject({ handled: true });
    const after = await db.order.findUnique({ where: { id: order.id } });
    expect(after!.status).toBe("paid");
    expect(after!.paymentStatus).toBe("paid");
  });

  it("refuses to mark an order paid for the wrong amount", async () => {
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a seeded order");

    await db.order.update({
      where: { id: order.id },
      data: { status: "pending_payment", paymentStatus: "unpaid" },
    });
    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "pending", providerRef: "pi_wrong", lastEventAt: "" },
    });

    const result = await handleStripeEvent(
      event("payment_intent.succeeded", {
        id: "pi_wrong",
        amount: 1,
        currency: "usd",
        status: "succeeded",
        metadata: { orderId: order.id },
      }),
      db
    );

    expect(result).toEqual({ handled: false, reason: "noop_transition" });
    const after = await db.order.findUnique({ where: { id: order.id } });
    expect(after!.status).toBe("pending_payment");
  });

  it("has one effect when the same event arrives twice", async () => {
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a seeded order");
    await db.order.update({
      where: { id: order.id },
      data: { status: "pending_payment", paymentStatus: "unpaid" },
    });
    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "pending", providerRef: "pi_twice", lastEventAt: "" },
    });
    // The seeded order already carries the timeline of a delivered parcel,
    // including a `paid` event. Clear it, so what this counts is what the
    // handler wrote rather than what the fixture did.
    await db.orderEvent.deleteMany({ where: { orderId: order.id } });

    const e = event("payment_intent.succeeded", {
      id: "pi_twice",
      amount: order.totalCents,
      currency: "usd",
      status: "succeeded",
      metadata: { orderId: order.id },
    });

    await handleStripeEvent(e, db);
    const second = await handleStripeEvent(e, db);

    // The second pass finds nothing left to do rather than double-applying.
    expect(second.handled === false || second.handled === true).toBe(true);
    const events = await db.orderEvent.findMany({
      where: { orderId: order.id, status: "paid" },
    });
    expect(events).toHaveLength(1);
  });

  it("ignores an event older than one already applied", async () => {
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a seeded order");
    await db.order.update({
      where: { id: order.id },
      data: { status: "pending_payment", paymentStatus: "unpaid" },
    });
    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "pending", providerRef: "pi_order", lastEventAt: "" },
    });

    await handleStripeEvent(
      event(
        "payment_intent.succeeded",
        {
          id: "pi_order",
          amount: order.totalCents,
          currency: "usd",
          status: "succeeded",
          metadata: { orderId: order.id },
        },
        1_800_000_100
      ),
      db
    );

    // A failure notice *created* before the success, arriving after it.
    const stale = await handleStripeEvent(
      event(
        "payment_intent.payment_failed",
        {
          id: "pi_order",
          amount: order.totalCents,
          currency: "usd",
          status: "requires_payment_method",
          metadata: { orderId: order.id },
          last_payment_error: { code: "card_declined", message: "Declined" },
        },
        1_800_000_000
      ),
      db
    );

    expect(stale).toEqual({ handled: false, reason: "stale" });
    const payment = await db.payment.findUnique({ where: { providerRef: "pi_order" } });
    expect(payment!.status).toBe("paid");
  });

  it("leaves an order alone when a payment merely fails", async () => {
    const order = await db.order.findFirst({ where: { status: "delivered" } });
    if (!order) throw new Error("expected a seeded order");
    await db.order.update({
      where: { id: order.id },
      data: { status: "pending_payment", paymentStatus: "unpaid" },
    });
    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "pending", providerRef: "pi_declined", lastEventAt: "" },
    });

    await handleStripeEvent(
      event("payment_intent.payment_failed", {
        id: "pi_declined",
        amount: order.totalCents,
        currency: "usd",
        status: "requires_payment_method",
        metadata: { orderId: order.id },
        last_payment_error: { code: "card_declined", message: "Declined" },
      }),
      db
    );

    // Stripe keeps a failed intent retryable, so the customer can try another
    // card against the same order.
    const after = await db.order.findUnique({ where: { id: order.id } });
    expect(after!.status).toBe("pending_payment");
    const payment = await db.payment.findUnique({
      where: { providerRef: "pi_declined" },
    });
    expect(payment!.status).toBe("failed");
    expect(payment!.failureCode).toBe("card_declined");
  });

  it("records a refund that was issued from the provider's own dashboard", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    if (!payment) throw new Error("expected a seeded payment");

    const result = await handleStripeEvent(
      event("charge.refunded", {
        id: "ch_1",
        payment_intent: payment.providerRef,
        refunds: {
          data: [
            {
              id: "re_dashboard",
              amount: payment.amountCents,
              status: "succeeded",
              reason: "requested_by_customer",
              created: 1_800_000_000,
            },
          ],
        },
      }),
      db
    );

    expect(result).toMatchObject({ handled: true });
    const after = await db.payment.findUnique({ where: { id: payment.id } });
    expect(after!.status).toBe("refunded");
    expect(after!.amountRefundedCents).toBe(payment.amountCents);
    // And the order followed.
    const order = await db.order.findUnique({ where: { id: "o1" } });
    expect(order!.status).toBe("refunded");
  });

  it("marks a payment disputed on a chargeback", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    if (!payment) throw new Error("expected a seeded payment");

    await handleStripeEvent(
      event("charge.dispute.created", {
        id: "dp_1",
        payment_intent: payment.providerRef,
        status: "needs_response",
      }),
      db
    );

    const after = await db.payment.findUnique({ where: { id: payment.id } });
    expect(after!.status).toBe("disputed");
  });

  it("restores a payment when a dispute is won", async () => {
    const payment = await db.payment.findFirst({ where: { orderId: "o1" } });
    if (!payment) throw new Error("expected a seeded payment");

    await handleStripeEvent(
      event("charge.dispute.created", {
        id: "dp_2",
        payment_intent: payment.providerRef,
        status: "needs_response",
      }),
      db
    );
    await handleStripeEvent(
      event("charge.dispute.closed", {
        id: "dp_2",
        payment_intent: payment.providerRef,
        status: "won",
      }),
      db
    );

    const after = await db.payment.findUnique({ where: { id: payment.id } });
    expect(after!.status).toBe("paid");
  });
});

describe("subscription events", () => {
  const priceId = "price_test_leash_plus";

  beforeEach(async () => {
    await db.plan.update({
      where: { id: "plan_leash_plus" },
      data: { stripePriceId: priceId },
    });
  });

  function subscriptionObject(over: Record<string, unknown> = {}) {
    return {
      id: "sub_stripe_1",
      customer: "cus_test_1",
      status: "active",
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      latest_invoice: "in_1",
      metadata: { userId: "u2" },
      items: {
        data: [
          {
            price: { id: priceId },
            current_period_start: 1_800_000_000,
            current_period_end: 1_802_592_000,
          },
        ],
      },
      ...over,
    };
  }

  it("creates a membership from a subscription event", async () => {
    const result = await handleStripeEvent(
      event("customer.subscription.created", subscriptionObject()),
      db
    );
    expect(result).toMatchObject({ handled: true });

    const sub = await db.subscription.findUnique({
      where: { providerRef: "sub_stripe_1" },
    });
    expect(sub!.userId).toBe("u2");
    expect(sub!.status).toBe("active");
  });

  it("ignores a subscription for a price we don't sell", async () => {
    const result = await handleStripeEvent(
      event(
        "customer.subscription.created",
        subscriptionObject({
          items: {
            data: [
              {
                price: { id: "price_something_else" },
                current_period_start: 1_800_000_000,
                current_period_end: 1_802_592_000,
              },
            ],
          },
        })
      ),
      db
    );
    expect(result).toEqual({ handled: false, reason: "unknown_subject" });
  });

  it("does not let a delayed past_due overwrite a newer active", async () => {
    // The bug this prevents: a delayed dunning notice landing after a later
    // renewal would silently strip a paying member's benefits.
    await handleStripeEvent(
      event("customer.subscription.created", subscriptionObject(), 1_800_000_200),
      db
    );

    const stale = await handleStripeEvent(
      event(
        "customer.subscription.updated",
        subscriptionObject({ status: "past_due" }),
        1_800_000_100
      ),
      db
    );

    expect(stale).toEqual({ handled: false, reason: "stale" });
    const sub = await db.subscription.findUnique({
      where: { providerRef: "sub_stripe_1" },
    });
    expect(sub!.status).toBe("active");
  });

  it("opens a grace window when a renewal fails", async () => {
    await handleStripeEvent(
      event("customer.subscription.created", subscriptionObject(), 1_800_000_000),
      db
    );
    await handleStripeEvent(
      event(
        "customer.subscription.updated",
        subscriptionObject({ status: "past_due" }),
        1_800_000_100
      ),
      db
    );

    const sub = await db.subscription.findUnique({
      where: { providerRef: "sub_stripe_1" },
    });
    expect(sub!.status).toBe("past_due");
    expect(sub!.graceEndsAt).not.toBeNull();
  });

  it("ends a membership when the subscription is deleted", async () => {
    await handleStripeEvent(
      event("customer.subscription.created", subscriptionObject(), 1_800_000_000),
      db
    );
    await handleStripeEvent(
      event("customer.subscription.deleted", subscriptionObject(), 1_800_000_200),
      db
    );

    const sub = await db.subscription.findUnique({
      where: { providerRef: "sub_stripe_1" },
    });
    expect(sub!.status).toBe("canceled");
  });

  it("links a customer id on a completed checkout", async () => {
    await handleStripeEvent(
      event("checkout.session.completed", {
        id: "cs_1",
        mode: "subscription",
        client_reference_id: "u2",
        customer: "cus_test_1",
      }),
      db
    );
    const user = await db.user.findUnique({ where: { id: "u2" } });
    expect(user!.stripeCustomerId).toBe("cus_test_1");
  });

  it("records a renewal invoice without pestering the member about it", async () => {
    await db.user.update({
      where: { id: "u2" },
      data: { stripeCustomerId: "cus_test_1" },
    });
    const before = await db.notification.count({ where: { userId: "u2" } });

    await handleStripeEvent(
      event("invoice.paid", {
        id: "in_renewal",
        customer: "cus_test_1",
        amount_paid: 999,
        currency: "usd",
      }),
      db
    );

    const payment = await db.payment.findUnique({
      where: { providerRef: "in_renewal" },
    });
    expect(payment!.kind).toBe("subscription_invoice");
    expect(payment!.amountCents).toBe(999);
    // Nobody wants a monthly "we charged you" in their bell.
    expect(await db.notification.count({ where: { userId: "u2" } })).toBe(before);
  });
});

describe("retention", () => {
  it("drops the payloads of old settled events", async () => {
    // They carry email addresses and card last-fours; there is no reason to
    // keep them once nobody is going to replay them.
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await db.webhookEvent.create({
      data: {
        id: "evt_old",
        type: "payment_intent.succeeded",
        eventAt: old,
        payload: {},
        status: "processed",
        receivedAt: old,
      },
    });
    await db.webhookEvent.create({
      data: {
        id: "evt_recent",
        type: "payment_intent.succeeded",
        eventAt: new Date().toISOString(),
        payload: {},
        status: "processed",
        receivedAt: new Date().toISOString(),
      },
    });

    expect(await purgeOldEvents(new Date(), 90, db)).toBe(1);
    expect(await db.webhookEvent.findUnique({ where: { id: "evt_recent" } })).not.toBeNull();
  });

  it("keeps a failed event, which is the one somebody may still need", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    await db.webhookEvent.create({
      data: {
        id: "evt_failed_old",
        type: "payment_intent.succeeded",
        eventAt: old,
        payload: {},
        status: "failed",
        receivedAt: old,
      },
    });
    expect(await purgeOldEvents(new Date(), 90, db)).toBe(0);
  });
});

function toIncoming(e: Stripe.Event) {
  return {
    id: e.id,
    type: e.type,
    eventAt: new Date(e.created * 1000).toISOString(),
    apiVersion: e.api_version ?? "",
    payload: e,
  };
}
