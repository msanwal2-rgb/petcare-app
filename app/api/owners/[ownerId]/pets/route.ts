import { createPet, getPetsByOwner } from "@/lib/server/pets";
import { petInputSchema } from "@/lib/validation/schemas";
import { error, ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/pets -> Pet[]
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  return ok(await getPetsByOwner(ownerId));
}

// POST /api/owners/:ownerId/pets -> Pet (201)
export async function POST(request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const parsed = await parseBody(request, petInputSchema);
  if ("response" in parsed) return parsed.response;
  // The path owner is authoritative; body ownerId (if any) must not override it.
  if (parsed.data.ownerId && parsed.data.ownerId !== ownerId) {
    return error("ownerId in body does not match path", 400);
  }
  const { ownerId: _ignored, ...petData } = parsed.data;
  return ok(await createPet(ownerId, petData), 201);
}
