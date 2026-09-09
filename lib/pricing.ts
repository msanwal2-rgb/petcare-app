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
const TAX_RATE = 0.0825;

/**
 * `freeShipping` is a plain boolean rather than a membership, deliberately.
 * This module is dependency-free so the cart and the server can share one
 * definition of the arithmetic; teaching it about subscriptions would drag the
 * database into a file the browser imports. Whoever calls it decides whether
 * the customer has earned it — for the server that is `quoteCart`, which reads
 * the membership itself.
 */
export function shippingFor(
  subtotalCents: number,
  opts: { freeShipping?: boolean; thresholdCents?: number } = {}
): number {
  if (opts.freeShipping) return 0;
  const threshold = opts.thresholdCents ?? FREE_SHIPPING_THRESHOLD_CENTS;
  return subtotalCents >= threshold ? 0 : FLAT_SHIPPING_CENTS;
}

export function taxFor(subtotalCents: number): number {
  return Math.round(subtotalCents * TAX_RATE);
}

/**
 * How much more to spend to cross the free-shipping line, or 0 if already there
 * — including when the customer is a member, who is always already there. A
 * member being told to "spend $12 more for free delivery" is the kind of detail
 * that makes a membership feel fake.
 */
export function amountToFreeShipping(
  subtotalCents: number,
  opts: { freeShipping?: boolean; thresholdCents?: number } = {}
): number {
  if (opts.freeShipping) return 0;
  const threshold = opts.thresholdCents ?? FREE_SHIPPING_THRESHOLD_CENTS;
  return Math.max(0, threshold - subtotalCents);
}
