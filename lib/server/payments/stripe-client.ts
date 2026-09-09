import Stripe from "stripe";

/**
 * The Stripe client, created on first use.
 *
 * Lazy rather than at module scope so that importing anything in this folder
 * does not require a secret key to be present — the demo provider has to keep
 * working, and the unit suite has to keep running, on a machine with no Stripe
 * credentials at all.
 *
 * The API version is pinned explicitly. Stripe's dashboard can move an
 * account's default version, and an unpinned client would silently start
 * receiving differently-shaped objects on a day nobody deployed anything.
 */
const API_VERSION = "2025-08-27.basil" as const;

let client: Stripe | null = null;

export function stripeClient(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Either set it, or run with LEASH_PAYMENTS=demo."
    );
  }

  client = new Stripe(key, {
    apiVersion: API_VERSION as Stripe.LatestApiVersion,
    // Shows up in Stripe's logs beside each request, which is what makes an
    // integration debuggable from their side rather than only from ours.
    appInfo: { name: "Leash", url: "https://petcare-app-drab.vercel.app" },
  });
  return client;
}

/** For tests, and for swapping in a mock account. */
export function setStripeClient(next: Stripe | null): void {
  client = next;
}

export { API_VERSION };
