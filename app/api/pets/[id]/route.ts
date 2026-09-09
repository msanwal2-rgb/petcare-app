import { getPetById, updatePet } from "@/lib/server/pets";
import { petPatchSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { canViewPet, requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id -> Pet | 404 — the owner, or a caretaker or vet currently
// looking after the animal.
//
// This was public, on the reasoning that a booking's caretaker has to be able
// to read it. They do — and now they can, and nobody else can: the response
// carries medications, allergies, behaviour notes and the household vet's phone
// number, against ids that count upward from p1.
//
// A pet somebody may not see reads as 404 rather than 403, so the id space
// cannot be mapped by watching which ones come back "forbidden".
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await canViewPet(auth.uid, id))) return notFound(`Pet ${id} not found`);

  const pet = await getPetById(id);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}

// PATCH /api/pets/:id -> Pet | 404 — only the pet's owner
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const existing = await prisma.pet.findUnique({
    where: { id },
    select: { ownerId: true },
  });
  if (!existing) return notFound(`Pet ${id} not found`);
  if (existing.ownerId !== auth.uid) return forbidden();

  const parsed = await parseBody(request, petPatchSchema);
  if ("response" in parsed) return parsed.response;
  const pet = await updatePet(id, parsed.data);
  return pet ? ok(pet) : notFound(`Pet ${id} not found`);
}
