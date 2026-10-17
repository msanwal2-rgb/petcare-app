/**
 * Stripe's publishable key, from `public/config.js` (editable on a deployed
 * server without a rebuild), falling back to the build-time
 * `VITE_STRIPE_PUBLISHABLE_KEY`.
 *
 * Publishable by design — it identifies the account, it authorises nothing,
 * and Stripe's own docs put it in client code. The secret key never leaves the
 * API. An empty value means the demo provider is active: checkout settles the
 * moment the order is placed and there is no card step.
 */
export const STRIPE_KEY: string =
  window.LEASH_CONFIG?.stripePublishableKey || import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
