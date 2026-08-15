import { getReviewsForUser } from "@/lib/server/reviews";
import { reviewKind } from "@/lib/validation/schemas";
import { badRequest, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/reviews[?kind=booking|vet_appointment] -> Review[]
//
// `kind` matters because one person can be reviewed as both a caretaker and a
// vet, and a clinic profile should not show reviews of their dog-walking.
export async function GET(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("kind");
  if (raw === null) return ok(await getReviewsForUser(id));

  const parsed = reviewKind.safeParse(raw);
  if (!parsed.success) return badRequest(`Unknown review kind "${raw}"`);
  return ok(await getReviewsForUser(id, parsed.data));
}
