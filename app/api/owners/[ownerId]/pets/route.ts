import { createPet, getPetsByOwner } from "@/lib/server/pets";
import { petInputSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/pets -> Pet[]  (your own pets)
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== ownerId) return forbidden();
  return ok(await getPetsByOwner(ownerId));
}

// POST /api/owners/:ownerId/pets -> Pet (201)
export async function POST(request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== ownerId) return forbidden();
  const parsed = await parseBody(request, petInputSchema);
  if ("response" in parsed) return parsed.response;
  // The body no longer carries an owner at all — the path owns the id, and the
  // check above owns the authorization. A client still sending one gets a 400
  // from the schema's `.strict()`.
  return ok(await createPet(ownerId, parsed.data), 201);
}
