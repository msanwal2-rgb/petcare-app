import type Stripe from "stripe";
import { stripeClient } from "./stripe-client";

/**
 * Recurring billing, kept as a separate interface from `PaymentProvider`.
 *
 * One fat interface would force the demo provider to stub five methods it
 * cannot honestly implement — and a stub that returns a plausible-looking
 * subscription is exactly the kind of thing that makes a demo pass while
 * production fails. Instead `subscriptionProvider()` returns null when
 * subscriptions are not configured, and callers answer 503.
 */
export interface SubscriptionSnapshotFromProvider {
  ref: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  customerRef: string;
  priceId: string;
}

export interface SubscriptionProvider {
  readonly name: string;
  ensureCustomer(input: {
    userId: string;
    email: string;
    name: string;
  }): Promise<string>;
  startCheckout(input: {
    customerRef: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  setCancelAtPeriodEnd(ref: string, value: boolean): Promise<void>;
  getSubscription(ref: string): Promise<SubscriptionSnapshotFromProvider>;
  portalUrl(input: { customerRef: string; returnUrl: string }): Promise<{ url: string }>;
}

function iso(seconds: number | null | undefined): string {
  return new Date((seconds ?? 0) * 1000).toISOString();
}

class StripeSubscriptionProvider implements SubscriptionProvider {
  readonly name = "stripe";

  async ensureCustomer(input: {
    userId: string;
    email: string;
    name: string;
  }): Promise<string> {
    const customer = await stripeClient().customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: { userId: input.userId },
      },
      // Keyed on the user, so a double-clicked subscribe button cannot create
      // two customers for one person and bill them twice.
      { idempotencyKey: `customer_${input.userId}` }
    );
    return customer.id;
  }

  async startCheckout(input: {
    customerRef: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    const session = await stripeClient().checkout.sessions.create({
      mode: "subscription",
      customer: input.customerRef,
      line_items: [{ price: input.priceId, quantity: 1 }],
      // How the webhook knows whose subscription this is.
      client_reference_id: input.userId,
      subscription_data: { metadata: { userId: input.userId } },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error("Stripe returned a session with no URL");
    return { url: session.url };
  }

  async setCancelAtPeriodEnd(ref: string, value: boolean): Promise<void> {
    await stripeClient().subscriptions.update(ref, { cancel_at_period_end: value });
  }

  async getSubscription(ref: string): Promise<SubscriptionSnapshotFromProvider> {
    const sub: Stripe.Subscription = await stripeClient().subscriptions.retrieve(ref);
    const item = sub.items.data[0];
    return {
      ref: sub.id,
      status: sub.status,
      currentPeriodStart: iso(item?.current_period_start),
      currentPeriodEnd: iso(item?.current_period_end),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      customerRef: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      priceId: item?.price?.id ?? "",
    };
  }

  async portalUrl(input: {
    customerRef: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: input.customerRef,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }
}

let override: SubscriptionProvider | null = null;
let overridden = false;

/**
 * The active subscription provider, or null when recurring billing is not
 * configured. Null rather than a stub: a caller that cannot tell the difference
 * would happily "subscribe" somebody to nothing.
 */
/**
 * Null until Stripe is configured *and* the Leash Plus price exists in it —
 * see docs/going-live.md. Callers answer 503 rather than pretending, because a
 * stub that returned a plausible subscription would let somebody "subscribe" to
 * nothing.
 */
export function subscriptionProvider(): SubscriptionProvider | null {
  if (overridden) return override;
  if (process.env.LEASH_PAYMENTS !== "stripe") return null;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new StripeSubscriptionProvider();
}

export function setSubscriptionProvider(next: SubscriptionProvider | null): void {
  override = next;
  overridden = true;
}

export function resetSubscriptionProvider(): void {
  override = null;
  overridden = false;
}

export { StripeSubscriptionProvider };
