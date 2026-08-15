import { createReview, getReviewsForSubject } from "@/lib/server/reviews";
import { reviewResponse } from "@/lib/server/review-http";
import { createReviewSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/appointments/:id/reviews -> Review[] (public — they appear on the
// vet's profile, so there is nothing private here)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getReviewsForSubject(id));
}

// POST /api/appointments/:id/reviews -> Review (201) | 403 | 409
//
// One direction only: the pet's owner reviews the vet, once the visit is
// complete, once. A vet cannot review the client back.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, createReviewSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.fromUserId !== auth.uid) return forbidden();

  return reviewResponse(
    await createReview(id, "vet_appointment", parsed.data),
    "Appointment"
  );
}
