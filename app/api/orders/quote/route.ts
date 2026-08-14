import { quoteCart } from "@/lib/server/orders";
import { quoteCartSchema } from "@/lib/validation/schemas";
import { ok, parseBody } from "@/lib/server/http";
import { forbidden, ownsPet, requireUser } from "@/lib/server/session";

// POST /api/orders/quote -> CartQuote
//
// Re-prices a cart without placing an order. The cart and checkout screens use
// this so the totals a customer sees are the ones they'll be charged, and so
// the prescription gate is evaluated before they reach the payment step.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, quoteCartSchema);
  if ("response" in parsed) return parsed.response;

  // Quoting against someone else's pet would leak which prescriptions it has.
  if (parsed.data.petId && !(await ownsPet(auth.uid, parsed.data.petId))) {
    return forbidden();
  }

  return ok(await quoteCart(parsed.data.items, parsed.data.petId));
}
