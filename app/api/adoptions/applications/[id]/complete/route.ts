import { completeAdoption } from "@/lib/server/adoptions/transfer";
import { completeAdoptionSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/adoptions/applications/:id/complete -> { application, pet }
//
// A command rather than a status PATCH, because it is not a field edit: it
// moves an animal between households, ends one set of people's access to a
// health record and begins another's, and refuses unless the fee has settled.
// A `PATCH { status: "completed" }` would hide all of that behind a shape that
// looks like renaming a pet.
//
// Shelter-only. The applicant pays at the sibling endpoint.
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, completeAdoptionSchema);
  if ("response" in parsed) return parsed.response;

  const result = await completeAdoption(id, auth.uid, {
    force: parsed.data.force,
  });
  if (result.ok) return ok(result);

  if (result.code === "not_found") return notFound(`Application ${id} not found`);
  if (result.code === "not_allowed") {
    return forbidden("Only the shelter can complete an adoption");
  }
  if (result.code === "invalid_transition") {
    return error("This application isn't ready to complete", 409, {
      from: result.from,
    });
  }
  if (result.code === "fee_unpaid") {
    return error("The adoption fee hasn't been paid yet", 409, {
      paymentStatus: result.paymentStatus,
    });
  }
  if (result.code === "not_shelter_owned") {
    // Either somebody else completed it a moment ago, or the animal was moved
    // by other means. Both are "reload and look again".
    return error("Your shelter no longer owns that animal", 409);
  }
  // The live-engagement refusal. The ids go back so the UI can name what is in
  // the way rather than saying no and leaving the shelter to guess.
  return error(
    "This animal still has a booking or a vet appointment open",
    409,
    {
      code: "live_engagements",
      bookingIds: result.bookingIds,
      appointmentIds: result.appointmentIds,
    }
  );
}
