import { startAdoptionPayment } from "@/lib/server/adoptions/payment";
import { error, forbidden, notFound, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/adoptions/applications/:id/payment -> { payment, status }
//
// The applicant's endpoint, deliberately: money moves when the payer acts.
// Completing the adoption is the shelter's, because the handover is theirs to
// record. Splitting them is what keeps each action with the party who performs
// it in the world.
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.checkout, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const result = await startAdoptionPayment(id, auth.uid);
  if (result.ok) return ok(result);

  if (result.code === "not_found") return notFound(`Application ${id} not found`);
  if (result.code === "not_applicant") {
    return forbidden("Only the applicant can pay this fee");
  }
  if (result.code === "not_approved") {
    return error("You can pay once the shelter has approved you", 409, {
      status: result.status,
    });
  }
  if (result.code === "no_fee") {
    return error("This adoption has no fee", 409);
  }
  if (result.code === "already_paid") {
    return error("This fee has already been paid", 409);
  }
  return error("We couldn't start the payment. Please try again.", 502);
}
