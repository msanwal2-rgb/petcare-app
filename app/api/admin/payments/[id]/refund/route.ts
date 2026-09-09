import { error, ok, parseBody } from "@/lib/server/http";
import { requireStaff } from "@/lib/server/session";
import { requestIp } from "@/lib/server/audit";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import { refundPayment } from "@/lib/server/admin/finance";
import { refundRequestSchema } from "@/lib/validation/admin-schemas";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/admin/payments/:id/refund -> { refundId, amountCents }
//
// Moving money is `finance`, not `support`: reading a customer's account to
// answer a ticket and sending them money are different decisions, and the whole
// point of splitting the staff roles was to be able to say so.
export async function POST(request: Request, ctx: Ctx) {
  const auth = await requireStaff("finance");
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.adminWrite, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const parsed = await parseBody(request, refundRequestSchema);
  if ("response" in parsed) return parsed.response;

  const result = await refundPayment(id, parsed.data, {
    uid: auth.uid,
    ip: requestIp(request),
  });

  if (result.ok) return ok(result);
  return error(result.message, result.code === "no_payment" ? 404 : 409);
}
