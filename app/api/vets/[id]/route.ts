import { getVetById } from "@/lib/server/vets";
import { notFound, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/vets/:id -> VetWithUser | 404. Public — this is a listing page.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const vet = await getVetById(id);
  return vet ? ok(vet) : notFound(`Vet ${id} not found`);
}
