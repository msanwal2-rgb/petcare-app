import { getOrdersForFulfillment } from "@/lib/server/orders";
import { forbidden, ok } from "@/lib/server/http";
import { isOps, requireUser } from "@/lib/server/session";

// GET /api/ops/orders -> Order[] — the fulfilment queue, oldest first.
// Auth: store operations staff only.
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await isOps(auth.uid))) return forbidden();
  return ok(await getOrdersForFulfillment());
}
