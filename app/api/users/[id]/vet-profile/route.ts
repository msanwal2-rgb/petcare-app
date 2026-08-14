import { getVetByUserId, upsertVetProfile } from "@/lib/server/vets";
import { vetPatchSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/vet-profile -> VetProfile | null(200)
// Public, mirroring the caretaker profile endpoint: a vet's profile is what
// owners browse. 200 with a null body when the user has no vet profile yet.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getVetByUserId(id));
}

// PATCH /api/users/:id/vet-profile -> VetProfile (upsert)
// Auth: only edit your own vet profile.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== id) return forbidden();

  const parsed = await parseBody(request, vetPatchSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await upsertVetProfile(id, parsed.data));
}
