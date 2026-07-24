import { createPet, getPetsByOwner } from "@/lib/server/pets";
import { petInputSchema } from "@/lib/validation/schemas";
import { error, forbidden, ok, parseBody } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/pets -> Pet[]  (your own pets)
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (uid !== ownerId) return forbidden();
  return ok(await getPetsByOwner(ownerId));
}

// POST /api/owners/:ownerId/pets -> Pet (201)
export async function POST(request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (uid !== ownerId) return forbidden();
  const parsed = await parseBody(request, petInputSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.ownerId && parsed.data.ownerId !== ownerId) {
    return error("ownerId in body does not match path", 400);
  }
  const { ownerId: _ignored, ...petData } = parsed.data;
  return ok(await createPet(ownerId, petData), 201);
}
