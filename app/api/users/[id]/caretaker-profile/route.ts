import { getCaretakerByUserId, upsertCaretakerProfile } from "@/lib/server/caretakers";
import { caretakerPatchSchema } from "@/lib/validation/schemas";
import { ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/users/:id/caretaker-profile -> CaretakerProfile | null(200)
// Returns 200 with null body when the user has no caretaker profile yet — the
// client treats "no profile" as a normal state, not a 404.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getCaretakerByUserId(id));
}

// PATCH /api/users/:id/caretaker-profile -> CaretakerProfile (upsert)
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, caretakerPatchSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await upsertCaretakerProfile(id, parsed.data));
}
