import {
  canCustomerCancel,
  getOrderById,
  updateOrderStatus,
} from "@/lib/server/orders";
import { error, forbidden, notFound, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/cancel -> Order
//
// Customer-initiated cancellation, allowed up until the order is with the
// carrier. After that the way back is a refund, which is ops' call. Cancelling
// returns the stock to the catalog.
export async function POST(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const order = await getOrderById(id);
  if (!order) return notFound(`Order ${id} not found`);
  if (order.userId !== auth.uid) return forbidden();

  if (!canCustomerCancel(order.status)) {
    return error(
      "This order has already shipped — contact us to arrange a return instead.",
      409,
      { status: order.status }
    );
  }

  const result = await updateOrderStatus(id, "cancelled");
  if (result.ok) return ok(result.order);
  if (result.code === "not_found") return notFound(`Order ${id} not found`);
  return error(`Cannot cancel an order that is "${result.from}"`, 409, {
    from: result.from,
  });
}
