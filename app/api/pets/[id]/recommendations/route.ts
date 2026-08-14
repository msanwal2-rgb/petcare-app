import { recommendedForPet } from "@/lib/server/products";
import { forbidden, notFound, ok } from "@/lib/server/http";
import { prisma } from "@/lib/db/prisma";
import { ownsPet, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id/recommendations -> Product[]
//
// Store products suited to this specific animal: right species, right life
// stage for its age, nothing containing an ingredient it reacts to, and
// nothing prescription-only. Owner-only, since the pet's allergies shape it.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await ownsPet(auth.uid, id))) return forbidden();

  const pet = await prisma.pet.findUnique({
    where: { id },
    select: { species: true, dob: true, allergies: true },
  });
  if (!pet) return notFound(`Pet ${id} not found`);

  return ok(await recommendedForPet(pet));
}
