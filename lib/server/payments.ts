/**
 * Payment provider boundary.
 *
 * The store talks to this interface and never to a payment SDK. What changed
 * from the first version of this file is the *shape* of the promise it makes.
 *
 * The old interface was `authorize` then `capture`, both synchronous, because
 * the demo provider could return instantly and nothing forced the question. A
 * real card payment cannot work that way: the customer confirms it in their own
 * browser, their bank may interpose a challenge, and the truth arrives later on
 * a webhook. Modelling that as two blocking calls would mean either lying about
 * when money moved or blocking a checkout request on a third party's timeline.
 *
 * So the interface is now `createIntent` / `getIntent` / `cancelIntent` /
 * `refund`, and settlement is something that *happens to* an order rather than
 * something checkout does to it. `asynchronous` says which kind of provider is
 * installed, so the demo can settle inline and Stripe cannot.
 *
 * `authorize` and `capture` are gone rather than deprecated. Leaving them as
 * no-ops would repeat the mistake `canTransitionPayment` made in this same
 * file: a function that exists, is exported, is unit-tested, and is never
 * called, which reads as covered and is not.
 */

import type { PaymentStatus } from "@/types";
import { genId } from "./ids";
import { StripePaymentProvider } from "./payments/stripe-provider";

/** Provider-side intent states, normalised across providers. */
export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_action"
  | "processing"
  | "authorized"
  | "succeeded"
  | "canceled"
  | "failed";

export interface PaymentIntentRecord {
  /** pi_… | demo_pi_… — stored on the Payment row as `providerRef`. */
  ref: string;
  status: PaymentIntentStatus;
  amountCents: number;
  currency: string;
  /**
   * Returned only by `createIntent`, and only to the one browser that is about
   * to confirm the payment. Never persisted, never logged, never in an audit
   * row: it authorises confirming this payment.
   */
  clientSecret: string | null;
  failureCode?: string;
  failureMessage?: string;
  /** For the receipt. The brand and last four, never a number or a token. */
  methodBrand?: string;
  methodLast4?: string;
}

export interface RefundRecord {
  ref: string;
  status: "pending" | "succeeded" | "failed" | "canceled";
  amountCents: number;
}

export interface PaymentProvider {
  readonly name: string;
  /**
   * True when confirmation happens in the customer's browser and the truth
   * arrives by webhook. False for the demo provider, which settles inline.
   */
  readonly asynchronous: boolean;

  createIntent(input: {
    amountCents: number;
    currency: string;
    orderId: string;
    userId: string;
    /**
     * The order id. A retried checkout must reuse the existing intent rather
     * than mint a second charge for the same basket.
     */
    idempotencyKey: string;
    customerRef?: string | null;
  }): Promise<PaymentIntentRecord>;

  getIntent(ref: string): Promise<PaymentIntentRecord>;
  cancelIntent(ref: string): Promise<PaymentIntentRecord>;

  refund(input: {
    ref: string;
    amountCents: number;
    reason?: RefundReason;
    idempotencyKey: string;
  }): Promise<RefundRecord>;
}

export type RefundReason =
  | "requested_by_customer"
  | "duplicate"
  | "fraudulent"
  | "order_cancelled";

/**
 * Legal payment transitions, enforced regardless of provider.
 *
 * This table has existed since the store shipped and was never consulted:
 * `paymentStatus` was written directly in two places in lib/server/orders.ts.
 * Every write now goes through `applyIntentState` in ./payments/ledger, which
 * checks it — a tested invariant that nothing enforces is worse than no
 * invariant, because it reads as covered.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ["pending", "processing", "requires_action", "authorized", "paid", "failed"],
  pending: ["requires_action", "processing", "authorized", "paid", "failed"],
  requires_action: ["pending", "processing", "authorized", "paid", "failed"],
  processing: ["paid", "authorized", "failed"],
  authorized: ["paid", "refunded", "failed"],
  paid: ["partially_refunded", "refunded", "disputed"],
  partially_refunded: ["refunded", "disputed"],
  // A dispute can be won as well as lost.
  disputed: ["refunded", "paid"],
  refunded: [],
  // A failed payment is retryable: Stripe keeps the intent alive.
  failed: ["pending", "requires_action", "processing", "authorized", "paid"],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus
): boolean {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}

/** How a provider intent state maps onto our own payment status. */
export function paymentStatusForIntent(status: PaymentIntentStatus): PaymentStatus {
  switch (status) {
    case "requires_payment_method":
      return "pending";
    case "requires_action":
      return "requires_action";
    case "processing":
      return "processing";
    case "authorized":
      return "authorized";
    case "succeeded":
      return "paid";
    case "canceled":
    case "failed":
      return "failed";
  }
}

/**
 * The simulation. Authorises and settles instantly, mints an obviously-fake
 * reference, and never touches money.
 *
 * It stays because it is what makes the seeded demo data, the browser suites
 * and most of the unit suite runnable with no credential in the environment —
 * and because `asynchronous: false` routes it through the *same* reconciler the
 * webhook uses, rather than a second code path that only the demo exercises.
 */
class DemoPaymentProvider implements PaymentProvider {
  readonly name = "demo";
  readonly asynchronous = false;

  async createIntent(input: {
    amountCents: number;
    currency: string;
  }): Promise<PaymentIntentRecord> {
    if (input.amountCents <= 0) {
      throw new Error("Cannot charge a non-positive amount");
    }
    return {
      ref: genId("demo_pi"),
      status: "succeeded",
      amountCents: input.amountCents,
      currency: input.currency,
      clientSecret: null,
      methodBrand: "demo",
      methodLast4: "0000",
    };
  }

  async getIntent(ref: string): Promise<PaymentIntentRecord> {
    return {
      ref,
      status: "succeeded",
      amountCents: 0,
      currency: "usd",
      clientSecret: null,
    };
  }

  async cancelIntent(ref: string): Promise<PaymentIntentRecord> {
    return {
      ref,
      status: "canceled",
      amountCents: 0,
      currency: "usd",
      clientSecret: null,
    };
  }

  async refund(input: { amountCents: number }): Promise<RefundRecord> {
    return {
      ref: genId("demo_re"),
      status: "succeeded",
      amountCents: input.amountCents,
    };
  }
}

let provider: PaymentProvider | null = null;

/**
 * Choose a provider from the environment, and **fail closed**.
 *
 * To go live: `vercel integration add stripe`, then `vercel env pull`, create
 * the Leash Plus price and write its id into `plans.stripePriceId`, register
 * the webhook, and set LEASH_PAYMENTS=stripe. Step by step, with the links
 * and the test cards, in docs/going-live.md.
 *
 * `LEASH_PAYMENTS=stripe` with no secret key throws rather than quietly falling
 * back to the demo, because the failure mode of that fallback is taking
 * pretend money for real orders and telling customers they are paid. This is
 * the same posture the assistant route takes with no model credential (503) and
 * the cron takes with no CRON_SECRET (refuse everything).
 */
function fromEnv(): PaymentProvider {
  const mode = process.env.LEASH_PAYMENTS ?? "demo";

  if (mode === "stripe") return new StripePaymentProvider();

  if (mode !== "demo") {
    throw new Error(
      `Unknown LEASH_PAYMENTS value "${mode}". Use "demo" or "stripe".`
    );
  }

  if (process.env.VERCEL_ENV === "production") {
    console.warn(
      "[payments] the demo provider is active in production — no money will move"
    );
  }
  return new DemoPaymentProvider();
}

/** The active provider. */
export function paymentProvider(): PaymentProvider {
  if (!provider) provider = fromEnv();
  return provider;
}

/** Injection point for tests and for a future real provider. */
export function setPaymentProvider(next: PaymentProvider | null): void {
  provider = next;
}

export { DemoPaymentProvider };
