"use client";

/**
 * Products the assistant found, as rows you can actually click.
 *
 * Prices arrive already formatted from the tool layer — the model never handles
 * a cent value and neither does this component. Rendering `product.price`
 * verbatim is the point: what the customer reads is what the database said.
 */

import Link from "next/link";

export interface SuggestedProduct {
  slug: string;
  name: string;
  brand: string;
  price: string;
  inStock: boolean;
  requiresPrescription: boolean;
  href: string;
}

export function ProductSuggestions({ products }: { products: SuggestedProduct[] }) {
  if (products.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1.5">
      {products.slice(0, 3).map((product) => (
        <li key={product.slug}>
          <Link
            href={product.href}
            className="flex items-baseline justify-between gap-3 rounded-xl border border-mist bg-white px-3 py-2 transition-colors hover:border-ink"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">
                {product.name}
              </span>
              <span className="block truncate text-xs text-charcoal/60">
                {product.brand}
                {product.requiresPrescription ? " · prescription" : ""}
                {product.inStock ? "" : " · out of stock"}
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs text-ink">{product.price}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
