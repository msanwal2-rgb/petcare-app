import { listBrands } from "@/lib/server/products";
import { ok } from "@/lib/server/http";

// GET /api/brands -> string[]. Powers the catalog's brand filter.
//
// Deliberately not /api/products/brands: that would sit in the same segment as
// the /api/products/[slug] detail route, and a product slugged "brands" would
// become unreachable. A facet is its own resource.
export async function GET() {
  return ok(await listBrands());
}
