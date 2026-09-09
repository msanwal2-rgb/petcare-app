import { getShelterByUserId, upsertShelterProfile } from "@/lib/server/shelters";
import { shelterPatchSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/shelter-profile -> ShelterProfile | null — public, so a
// shelter's own page can render before they have finished filling it in.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getShelterByUserId(id));
}

// PATCH /api/users/:id/shelter-profile -> ShelterProfile (upsert) — self only.
//
// `verificationStatus` and `responseRatePct` are absent from the schema: one is
// a person's decision in the admin console and the other is computed from
// application statuses. A form that could set either would make both worthless.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== id) return forbidden();

  const parsed = await parseBody(request, shelterPatchSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await upsertShelterProfile(id, parsed.data));
}
