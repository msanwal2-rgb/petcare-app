import { createOrder, getOrdersByUser } from "@/lib/server/orders";
import { createOrderSchema } from "@/lib/validation/schemas";
import { badRequest, error, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// GET /api/orders -> Order[] — your own orders, newest first.
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  return ok(await getOrdersByUser(auth.uid));
}

// POST /api/orders -> Order (201)
//
// The body carries what the customer wants, not what it costs: the server
// re-prices every line against the live catalog and charges its own total.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, createOrderSchema);
  if ("response" in parsed) return parsed.response;

  const result = await createOrder(auth.uid, parsed.data);
  // The payment block carries the clientSecret the browser needs to confirm.
  // It is returned to exactly this one response and never stored.
  if (result.ok) return ok({ ...result.order, payment: result.payment }, 201);

  if (result.code === "empty") return badRequest("Your cart is empty");
  if (result.code === "stock_race") {
    // Someone bought the last one between quoting and paying.
    return error("That item sold out while you were checking out", 409, {
      productId: result.productId,
    });
  }
  if (result.code === "payment_setup_failed") {
    // The order exists and holds its stock; only the intent failed. 502 rather
    // than 500 because the fault is the payment provider's, and the orderId is
    // returned so the client can retry that step instead of the whole cart.
    return error("We couldn't start the payment. Please try again.", 502, {
      orderId: result.orderId,
    });
  }
  // 409: the cart is well-formed but no longer satisfiable. The quote comes
  // back so the client can show exactly which line is the problem.
  return error("Some items are no longer available", 409, { quote: result.quote });
}
