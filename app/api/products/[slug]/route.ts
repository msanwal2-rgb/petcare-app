import { getProductBySlug } from "@/lib/server/products";
import { notFound, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ slug: string }> };

// GET /api/products/:slug -> Product | 404. Public.
export async function GET(_request: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const product = await getProductBySlug(slug);
  return product ? ok(product) : notFound(`Product ${slug} not found`);
}
