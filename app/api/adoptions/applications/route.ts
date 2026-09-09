import {
  createApplication,
  getApplicationsByApplicant,
  getApplicationsForShelter,
} from "@/lib/server/adoptions/applications";
import { getShelterByUserId } from "@/lib/server/shelters";
import { adoptionApplicationSchema } from "@/lib/validation/schemas";
import { badRequest, error, forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import type { ApplicationStatus } from "@/types";

// GET /api/adoptions/applications -> AdoptionApplication[]
//
// Yours as an applicant by default; `?as=shelter` returns your shelter's queue
// instead. Two audiences, one resource, and the caller says which hat they are
// wearing — the same shape the assistant's read tools use.
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  if (url.searchParams.get("as") === "shelter") {
    const shelter = await getShelterByUserId(auth.uid);
    if (!shelter) return forbidden("You don't have a shelter profile");
    const status = url.searchParams.get("status") as ApplicationStatus | null;
    return ok(await getApplicationsForShelter(shelter.id, status ?? undefined));
  }

  return ok(await getApplicationsByApplicant(auth.uid));
}

// POST /api/adoptions/applications -> AdoptionApplication (201)
//
// The applicant is whoever is signed in — there is no field for it, so there is
// nothing to disagree with the session.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, adoptionApplicationSchema);
  if ("response" in parsed) return parsed.response;

  const result = await createApplication(auth.uid, parsed.data);
  if (result.ok) return ok(result.application, 201);

  if (result.code === "not_found") return badRequest("No such listing");
  if (result.code === "listing_unavailable") {
    return error("That animal is no longer available", 409, {
      status: result.status,
    });
  }
  if (result.code === "own_listing") {
    return badRequest("That's your own listing");
  }
  if (result.code === "duplicate") {
    return error("You already have an open application for this animal", 409);
  }
  return badRequest("Could not submit that application");
}
