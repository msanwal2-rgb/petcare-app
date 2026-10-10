/**
 * Store pricing — the cart's **estimate**. All amounts integer cents.
 *
 * A mirror of `Leash.Core/Services/StorePricing.cs`, kept so the cart can show
 * a total before it has asked the server. It is never the figure charged: the
 * checkout uses the server's quote, which re-reads every product, reads the
 * free-shipping threshold from settings, and (from M7) knows whether the
 * customer is a member. If this and the quote ever disagree, the quote is right
 * and this file is the one to fix.
 *
 * Tax is basis points rather than a float for the same reason the server does
 * it that way — 8.25% of 1999 should be 165 here and there, not 164.91749999.
 */

export const DEFAULT_FREE_SHIPPING_THRESHOLD_CENTS = 4900;
export const FLAT_SHIPPING_CENTS = 599;
const TAX_RATE_BASIS_POINTS = 825;

export function shippingFor(subtotalCents: number, thresholdCents: number): number {
  return subtotalCents >= thresholdCents ? 0 : FLAT_SHIPPING_CENTS;
}

/** Math.round is half-up for positive numbers, matching the server's AwayFromZero. */
export function taxFor(subtotalCents: number): number {
  return Math.round((subtotalCents * TAX_RATE_BASIS_POINTS) / 10_000);
}
