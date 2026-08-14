/**
 * Store catalog — API client. See /lib/api/caretakers.ts for the pattern.
 */

import type { Product, ProductPage, ProductSearchParams } from "@/types";
import { getJson, getJsonOrNull, qs } from "./_client";

/** GET /api/products -> ProductPage */
export async function searchProducts(
  params: ProductSearchParams = {}
): Promise<ProductPage> {
  return getJson<ProductPage>(
    `/api/products${qs({
      q: params.q,
      category: params.category,
      species: params.species,
      lifeStage: params.lifeStage,
      brand: params.brand,
      minPriceCents: params.minPriceCents,
      maxPriceCents: params.maxPriceCents,
      sort: params.sort,
      limit: params.limit,
      offset: params.offset,
    })}`
  );
}

/** GET /api/products/:slug -> Product | null(404) */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  return getJsonOrNull<Product>(`/api/products/${slug}`);
}

/** GET /api/brands -> string[] */
export async function listBrands(): Promise<string[]> {
  return getJson<string[]>(`/api/brands`);
}
