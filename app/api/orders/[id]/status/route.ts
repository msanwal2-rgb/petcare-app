import { updateOrderStatus } from "@/lib/server/orders";
import { updateOrderStatusSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { isOps, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/orders/:id/status -> Order
//
// Fulfilment. Ops-only: this is the endpoint that moves an order from the
// warehouse to the doorstep and appends the customer-visible timeline event.
// Customers cancel through /cancel instead.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await isOps(auth.uid))) {
    return forbidden("Only store operations can advance an order");
  }

  const parsed = await parseBody(request, updateOrderStatusSchema);
  if ("response" in parsed) return parsed.response;

  const { status, ...options } = parsed.data;
  const result = await updateOrderStatus(id, status, options);
  if (result.ok) return ok(result.order);
  if (result.code === "not_found") return notFound(`Order ${id} not found`);
  if (result.code === "concurrent_change") {
    // Someone else moved it while this request was deciding — the cron, or
    // another operator. Retrying against fresh state is the right answer.
    return error("That order was just changed by someone else. Reload and try again.", 409, {
      from: result.from,
    });
  }
  return error(
    `Cannot move an order from "${result.from}" to "${result.to}"`,
    409,
    { from: result.from, to: result.to }
  );
}
