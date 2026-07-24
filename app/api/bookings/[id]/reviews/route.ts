import { createReview, getReviewsForBooking } from "@/lib/server/reviews";
import { createReviewSchema } from "@/lib/validation/schemas";
import { ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id/reviews -> Review[]
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getReviewsForBooking(id));
}

// POST /api/bookings/:id/reviews -> Review (201)
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, createReviewSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await createReview(id, parsed.data), 201);
}
