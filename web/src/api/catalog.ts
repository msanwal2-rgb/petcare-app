import type { Product, ProductPage, ProductSearchParams } from "@/types";
import { getJson, getJsonOrNull, qs } from "./_client";

/**
 * The store catalogue — API client. Public: browsing needs no account.
 *
 * One file per domain, and pages call ONLY these — never `fetch` directly. That
 * rule is what kept the reference project's frontend portable enough to move
 * here with two lines changed, and it is worth keeping for the same reason.
 *
 * ── The cursor is opaque ──
 *
 * `nextCursor` comes back and goes out unchanged. It encodes the sort it was
 * minted under, so one carried across a change of sort simply starts again —
 * drop it whenever a filter or the sort changes.
 */

/** Distinct brands across the active catalogue. Powers the brand filter. */
export function listBrands(): Promise<string[]> {
  return getJson<string[]>("/brands");
}

/** GET /products -> one page, filtered and sorted in PostgreSQL. */
export function searchProducts(params: ProductSearchParams = {}): Promise<ProductPage> {
  return getJson<ProductPage>(`/products${qs(params as Record<string, unknown>)}`);
}

/** GET /products/:slug -> the product page, or null. Withdrawn products still resolve, for old orders' links. */
export function getProduct(slug: string): Promise<Product | null> {
  return getJsonOrNull<Product>(`/products/${encodeURIComponent(slug)}`);
}
