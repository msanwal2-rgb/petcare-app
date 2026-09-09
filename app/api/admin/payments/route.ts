import { ok, parseQuery } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { searchPayments } from "@/lib/server/admin/finance";
import { adminPaymentQuerySchema } from "@/lib/validation/admin-schemas";

// GET /api/admin/payments -> AdminPaymentPage — finance only.
export async function GET(request: Request) {
  const auth = await requireStaff("finance");
  if ("response" in auth) return auth.response;

  const parsed = parseQuery(request, adminPaymentQuerySchema);
  if ("response" in parsed) return parsed.response;

  return ok(await searchPayments(parsed.data));
}
