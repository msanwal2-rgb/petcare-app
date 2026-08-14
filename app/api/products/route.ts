import { searchProducts } from "@/lib/server/products";
import { productQuerySchema } from "@/lib/validation/schemas";
import { ok, parseQuery } from "@/lib/server/http";

// GET /api/products?q&category&species&lifeStage&brand&minPriceCents&maxPriceCents&sort&limit&offset
// -> ProductPage. Public — this is the shop window.
export async function GET(request: Request) {
  const parsed = parseQuery(request, productQuerySchema);
  if ("response" in parsed) return parsed.response;
  return ok(await searchProducts(parsed.data));
}
