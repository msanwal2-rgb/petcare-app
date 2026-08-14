/**
 * Payment provider boundary.
 *
 * The store talks to this interface and never to a payment SDK, so swapping in
 * a real provider is a new implementation of `PaymentProvider` plus a webhook
 * that calls `markPaid` — no changes to the order model, the checkout
 * transaction, or the UI.
 *
 * The demo provider below authorises and captures instantly. It is honest
 * about being a simulation: it mints an obviously-fake reference and never
 * touches money. The `paymentStatus` state machine it drives is real, which is
 * the part that has to be right before a provider is plugged in.
 */

import type { PaymentStatus } from "@/types";
import { genId } from "./ids";

export interface PaymentIntent {
  /** Provider-side reference, stored on the order as `paymentRef`. */
  ref: string;
  status: PaymentStatus;
}

export interface PaymentProvider {
  readonly name: string;
  /** Reserve the funds for an order total, in integer cents. */
  authorize(amountCents: number, meta: { orderId: string }): Promise<PaymentIntent>;
  /** Take the reserved funds. */
  capture(ref: string): Promise<PaymentIntent>;
  /** Return captured funds, in whole or in part. */
  refund(ref: string, amountCents: number): Promise<PaymentIntent>;
}

/** Legal payment transitions, enforced regardless of provider. */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  unpaid: ["authorized", "paid", "failed"],
  authorized: ["paid", "refunded", "failed"],
  paid: ["refunded"],
  refunded: [],
  failed: ["authorized", "paid"],
};

export function canTransitionPayment(
  from: PaymentStatus,
  to: PaymentStatus
): boolean {
  return from === to || PAYMENT_TRANSITIONS[from].includes(to);
}

class DemoPaymentProvider implements PaymentProvider {
  readonly name = "demo";

  async authorize(amountCents: number): Promise<PaymentIntent> {
    if (amountCents <= 0) {
      throw new Error("Cannot authorize a non-positive amount");
    }
    return { ref: genId("demo_pay"), status: "authorized" };
  }

  async capture(ref: string): Promise<PaymentIntent> {
    return { ref, status: "paid" };
  }

  async refund(ref: string): Promise<PaymentIntent> {
    return { ref, status: "refunded" };
  }
}

let provider: PaymentProvider = new DemoPaymentProvider();

/** The active provider. Swap it here (or via `setPaymentProvider`) to go live. */
export function paymentProvider(): PaymentProvider {
  return provider;
}

/** Injection point for tests and for a future real provider. */
export function setPaymentProvider(next: PaymentProvider): void {
  provider = next;
}
