import type Stripe from "stripe";
import { stripeClient } from "./stripe-client";
import type {
  PaymentIntentRecord,
  PaymentIntentStatus,
  PaymentProvider,
  RefundRecord,
  RefundReason,
} from "../payments";

/**
 * Stripe, behind the app's own payment interface.
 *
 * Type-only imports from ../payments deliberately: that module chooses this
 * one at runtime, and a value import in this direction would close the cycle.
 *
 * Nothing here persists anything. Every state change lands in the ledger
 * through `applyIntentState`, whether it arrived from a webhook, from the
 * confirmation page's sync call, or from a staff member's refund.
 */

/** Stripe's PaymentIntent statuses, mapped onto ours. */
function intentStatus(pi: Stripe.PaymentIntent): PaymentIntentStatus {
  switch (pi.status) {
    case "requires_payment_method":
      return "requires_payment_method";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    case "processing":
      return "processing";
    // Only reachable with manual capture, which this app does not currently
    // use — kept mapped so turning it on is a config change, not a code change.
    case "requires_capture":
      return "authorized";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

function cardDetails(pi: Stripe.PaymentIntent): {
  methodBrand?: string;
  methodLast4?: string;
} {
  const method = pi.latest_charge;
  if (!method || typeof method === "string") return {};
  const card = method.payment_method_details?.card;
  if (!card) return {};
  return { methodBrand: card.brand ?? undefined, methodLast4: card.last4 ?? undefined };
}

function toRecord(pi: Stripe.PaymentIntent): PaymentIntentRecord {
  return {
    ref: pi.id,
    status: intentStatus(pi),
    amountCents: pi.amount,
    currency: pi.currency,
    // Only ever returned to the browser that is about to confirm this payment.
    clientSecret: pi.client_secret,
    failureCode: pi.last_payment_error?.code ?? undefined,
    failureMessage: pi.last_payment_error?.message ?? undefined,
    ...cardDetails(pi),
  };
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly asynchronous = true;

  async createIntent(input: {
    amountCents: number;
    currency: string;
    orderId: string;
    userId: string;
    idempotencyKey: string;
    customerRef?: string | null;
  }): Promise<PaymentIntentRecord> {
    const pi = await stripeClient().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        automatic_payment_methods: { enabled: true },
        ...(input.customerRef ? { customer: input.customerRef } : {}),
        // The webhook resolves an event back to an order through this, so it is
        // not decoration — it is the join key.
        metadata: { orderId: input.orderId, userId: input.userId },
      },
      // Keyed on the order: a retried checkout reuses the existing intent
      // rather than minting a second charge for the same basket.
      { idempotencyKey: `order_${input.idempotencyKey}` }
    );
    return toRecord(pi);
  }

  async getIntent(ref: string): Promise<PaymentIntentRecord> {
    const pi = await stripeClient().paymentIntents.retrieve(ref, {
      expand: ["latest_charge"],
    });
    return toRecord(pi);
  }

  async cancelIntent(ref: string): Promise<PaymentIntentRecord> {
    const pi = await stripeClient().paymentIntents.cancel(ref);
    return toRecord(pi);
  }

  async refund(input: {
    ref: string;
    amountCents: number;
    reason?: RefundReason;
    idempotencyKey: string;
  }): Promise<RefundRecord> {
    // Stripe accepts a narrower reason vocabulary than ours; anything outside
    // it is sent without a reason rather than rejected, and our own `Refund`
    // row keeps the full one.
    const reason =
      input.reason === "duplicate" ||
      input.reason === "fraudulent" ||
      input.reason === "requested_by_customer"
        ? input.reason
        : undefined;

    const refund = await stripeClient().refunds.create(
      {
        payment_intent: input.ref,
        amount: input.amountCents,
        ...(reason ? { reason } : {}),
      },
      { idempotencyKey: `refund_${input.idempotencyKey}` }
    );

    return {
      ref: refund.id,
      // Stripe reports "pending" for anything that has not settled; the
      // charge.refunded webhook completes it.
      status:
        refund.status === "succeeded"
          ? "succeeded"
          : refund.status === "failed"
            ? "failed"
            : refund.status === "canceled"
              ? "canceled"
              : "pending",
      amountCents: refund.amount,
    };
  }
}
