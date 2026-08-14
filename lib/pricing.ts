/**
 * Store pricing rules.
 *
 * Deliberately dependency-free so both sides can use the same arithmetic: the
 * server computes the authoritative total in lib/server/orders.ts, and the cart
 * shows a matching estimate before checkout without importing anything that
 * touches the database. One definition, so the two can't drift.
 *
 * All amounts are integer cents.
 */

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 4900;
export const FLAT_SHIPPING_CENTS = 599;
/** Single blended rate; a real store would resolve this per destination. */
export const TAX_RATE = 0.0825;

export function shippingFor(subtotalCents: number): number {
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}

export function taxFor(subtotalCents: number): number {
  return Math.round(subtotalCents * TAX_RATE);
}

/** How much more to spend to cross the free-shipping line, or 0 if already there. */
export function amountToFreeShipping(subtotalCents: number): number {
  return Math.max(0, FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents);
}
