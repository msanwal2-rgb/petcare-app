import { createReview, getReviewsForSubject } from "@/lib/server/reviews";
import { reviewResponse } from "@/lib/server/review-http";
import { createReviewSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id/reviews -> Review[] (public)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getReviewsForSubject(id));
}

// POST /api/bookings/:id/reviews -> Review (201) | 403 | 409
//
// Bookings are reviewed both ways. Everything else — that you took part, that
// it finished, that you haven't already — is re-derived from the booking.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, createReviewSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.fromUserId !== auth.uid) return forbidden();

  return reviewResponse(await createReview(id, "booking", parsed.data), "Booking");
}
