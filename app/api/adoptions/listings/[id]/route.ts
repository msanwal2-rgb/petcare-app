import { getListingById, updateListing } from "@/lib/server/adoptions/listings";
import { adoptionListingPatchSchema } from "@/lib/validation/schemas";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/adoptions/listings/:id -> AdoptionListingWithPet | 404 — public.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const listing = await getListingById(id);
  return listing ? ok(listing) : notFound(`Listing ${id} not found`);
}

// PATCH /api/adoptions/listings/:id -> AdoptionListingWithPet — the shelter's.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, adoptionListingPatchSchema);
  if ("response" in parsed) return parsed.response;

  const result = await updateListing(id, auth.uid, parsed.data);
  if (result.ok) return ok(result.listing);
  if (result.code === "not_found") return notFound(`Listing ${id} not found`);
  return forbidden("That isn't your listing");
}
