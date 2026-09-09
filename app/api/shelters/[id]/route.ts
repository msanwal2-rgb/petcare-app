import { getShelterById } from "@/lib/server/shelters";
import { notFound, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/shelters/:id -> ShelterWithUser | 404 — public.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const shelter = await getShelterById(id);
  return shelter ? ok(shelter) : notFound(`Shelter ${id} not found`);
}
