import { ok, parseQuery } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { searchSubscriptions } from "@/lib/server/admin/finance";
import { adminSubscriptionQuerySchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/subscriptions -> AdminSubscriptionPage — finance only.
export async function GET(request: Request) {
  const auth = await requireStaff("finance");
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(request, adminSubscriptionQuerySchema);
  if ("response" in parsed) return parsed.response;

  return ok(await searchSubscriptions(parsed.data));
}
