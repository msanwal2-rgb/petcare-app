import { createReview, getReviewsForBooking } from "@/lib/server/reviews";
import { createReviewSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id/reviews -> Review[] (public)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getReviewsForBooking(id));
}

// POST /api/bookings/:id/reviews -> Review (201)
// Auth: you can only leave a review authored by yourself.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(request, createReviewSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.fromUserId !== auth.uid) return forbidden();
  return ok(await createReview(id, parsed.data), 201);
}
