/**
 * Vet consultation pricing.
 *
 * Separate from lib/pricing.ts, and dependency-free for the same reason: the
 * booking form and the server both need the same arithmetic, and one definition
 * cannot drift from itself.
 *
 * Note the units. The store is integer cents; bookings and vet appointments are
 * Float USD, and that split is deliberate and load-bearing across the schema.
 * This file lives on the Float side, which is why it rounds explicitly — an
 * unrounded percentage of a dollar amount is how $89.60000000000001 reaches a
 * receipt.
 */

export interface ConsultPricing {
  /** The vet's list fee, before any discount. */
  baseFee: number;
  discountPct: number;
  /** What the customer is actually quoted. */
  fee: number;
}

export function consultFeeFor(
  baseFee: number,
  opts: { discountPct?: number } = {}
): ConsultPricing {
  const pct = Math.max(0, Math.min(100, Math.round(opts.discountPct ?? 0)));
  const fee = Math.round(baseFee * (100 - pct)) / 100;
  return { baseFee, discountPct: pct, fee };
}
