import { getPetById, updatePet } from "@/lib/server/pets";
import { petPatchSchema } from "@/lib/validation/schemas";
import { notFound, ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id -> Pet | 404
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const pet = await getPetById(id);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}

// PATCH /api/pets/:id -> Pet | 404
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, petPatchSchema);
  if ("response" in parsed) return parsed.response;
  const pet = await updatePet(id, parsed.data);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}
