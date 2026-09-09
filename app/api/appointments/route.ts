import { createAppointment } from "@/lib/server/appointments";
import { createAppointmentSchema } from "@/lib/validation/schemas";
import { badRequest, error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { ownsPet, requireUser } from "@/lib/server/session";

// POST /api/appointments -> VetAppointment (201, status=requested)
// Auth: signed in, for a pet you own. The appointment is always booked as the
// caller — there is no owner field to disagree with the session.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, createAppointmentSchema);
  if ("response" in parsed) return parsed.response;
  if (!(await ownsPet(auth.uid, parsed.data.petId))) {
    return forbidden("You can only book appointments for your own pets");
  }

  const result = await createAppointment(auth.uid, parsed.data);
  if (result.ok) return ok(result.appointment, 201);
  if (result.code === "vet_not_found") return notFound("Vet or pet not found");
  if (result.code === "species_not_accepted") {
    return badRequest(`This vet doesn't treat ${result.species}s`);
  }
  if (result.code === "lead_time") {
    // 409 rather than 400: the request is well-formed, the timing is what's
    // wrong. The member window is returned so the UI can offer the upgrade
    // instead of only refusing.
    return error("That's too soon to book", 409, {
      earliestAt: result.earliestAt,
      memberEarliestAt: result.memberEarliestAt,
      isMember: result.isMember,
    });
  }
  return badRequest("This vet doesn't offer that kind of consultation");
}
