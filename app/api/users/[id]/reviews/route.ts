import { getReviewsForUser } from "@/lib/server/reviews";
import { ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/reviews -> Review[] (about this user, newest first)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getReviewsForUser(id));
}
