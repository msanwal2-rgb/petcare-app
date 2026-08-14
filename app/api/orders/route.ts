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
  if (result.ok) return ok(result.order, 201);

  if (result.code === "empty") return badRequest("Your cart is empty");
  if (result.code === "stock_race") {
    // Someone bought the last one between quoting and paying.
    return error("That item sold out while you were checking out", 409, {
      productId: result.productId,
    });
  }
  // 409: the cart is well-formed but no longer satisfiable. The quote comes
  // back so the client can show exactly which line is the problem.
  return error("Some items are no longer available", 409, { quote: result.quote });
}
