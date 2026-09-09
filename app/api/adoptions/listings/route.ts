import { createListing, searchListings } from "@/lib/server/adoptions/listings";
import { getShelterByUserId } from "@/lib/server/shelters";
import {
  adoptionListingQuerySchema,
  adoptionListingSchema,
} from "@/lib/validation/schemas";
import { badRequest, error, forbidden, ok, parseBody, parseQuery } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// GET /api/adoptions/listings -> AdoptionListingPage — public.
//
// Only `available` listings, and ordered longest-waiting first: a directory
// that leads with new arrivals is one where the animals who need it most are
// never seen.
export async function GET(request: Request) {
  const parsed = parseQuery(request, adoptionListingQuerySchema);
  if ("response" in parsed) return parsed.response;
  return ok(await searchListings(parsed.data));
}

// POST /api/adoptions/listings -> AdoptionListingWithPet (201) — shelters only.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const shelter = await getShelterByUserId(auth.uid);
  if (!shelter) return forbidden("You need a shelter profile to list an animal");

  const parsed = await parseBody(request, adoptionListingSchema);
  if ("response" in parsed) return parsed.response;

  const result = await createListing(shelter.id, parsed.data);
  if (result.ok) return ok(result.listing, 201);

  if (result.code === "not_found") return badRequest("No such animal");
  if (result.code === "pet_not_yours") {
    // The join between the two halves of this feature: a listing is a claim
    // about an animal, and only its owner may make it.
    return forbidden("You can only list an animal your shelter owns");
  }
  if (result.code === "already_listed") {
    return error("That animal is already listed", 409);
  }
  return badRequest("Could not create that listing");
}
