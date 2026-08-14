import { getOrderById } from "@/lib/server/orders";
import { forbidden, notFound, ok } from "@/lib/server/http";
import { isOps, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/orders/:id -> Order (with items and the tracking timeline)
// Auth: the customer who placed it, or store operations staff.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const order = await getOrderById(id);
  if (!order) return notFound(`Order ${id} not found`);
  if (order.userId !== auth.uid && !(await isOps(auth.uid))) return forbidden();

  return ok(order);
}
