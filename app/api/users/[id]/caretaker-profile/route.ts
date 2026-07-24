import { getCaretakerByUserId, upsertCaretakerProfile } from "@/lib/server/caretakers";
import { caretakerPatchSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/caretaker-profile -> CaretakerProfile | null(200)
// Public: a caretaker's profile is shown on their public page. Returns 200 with
// null body when the user has no caretaker profile yet.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getCaretakerByUserId(id));
}

// PATCH /api/users/:id/caretaker-profile -> CaretakerProfile (upsert)
// Auth: only edit your own caretaker profile.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (uid !== id) return forbidden();
  const parsed = await parseBody(request, caretakerPatchSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await upsertCaretakerProfile(id, parsed.data));
}
