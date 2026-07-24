import { getPetById, updatePet } from "@/lib/server/pets";
import { petPatchSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id -> Pet | 404  (public: attached pets are visible to a
// booking's caretaker, so this is intentionally readable)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const pet = await getPetById(id);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}

// PATCH /api/pets/:id -> Pet | 404 — only the pet's owner
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  const existing = await prisma.pet.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!existing) return notFound(`Pet ${id} not found`);
  if (existing.ownerId !== uid) return forbidden();

  const parsed = await parseBody(request, petPatchSchema);
  if ("response" in parsed) return parsed.response;
  const pet = await updatePet(id, parsed.data);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}
