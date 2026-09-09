import { setListingStatus } from "@/lib/server/adoptions/listings";
import { listingStatusSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/adoptions/listings/:id/status -> AdoptionListingWithPet
//
// Publishing re-asserts that the shelter still owns the animal, so a row
// cannot be edited back into circulation after the pet has been adopted out.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, listingStatusSchema);
  if ("response" in parsed) return parsed.response;

  const result = await setListingStatus(id, parsed.data.status, auth.uid);
  if (result.ok) return ok(result.listing);
  if (result.code === "not_found") return notFound(`Listing ${id} not found`);
  if (result.code === "not_yours") return forbidden("That isn't your listing");
  if (result.code === "pet_not_yours") {
    return error("Your shelter no longer owns that animal", 409);
  }
  if (result.code === "invalid_transition") {
    return error(
      `Cannot move a listing from "${result.from}" to "${result.to}"`,
      409,
      { from: result.from, to: result.to }
    );
  }
  return error("That animal is already listed", 409);
}
