import { createAppointment } from "@/lib/server/appointments";
import { createAppointmentSchema } from "@/lib/validation/schemas";
import { badRequest, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { ownsPet, requireUser } from "@/lib/server/session";

// POST /api/appointments -> VetAppointment (201, status=requested)
// Auth: signed in, booking as yourself, for a pet you own.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = await parseBody(request, createAppointmentSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.ownerId !== auth.uid) return forbidden();
  if (!(await ownsPet(auth.uid, parsed.data.petId))) {
    return forbidden("You can only book appointments for your own pets");
  }

  const result = await createAppointment(parsed.data);
  if (result.ok) return ok(result.appointment, 201);
  if (result.code === "vet_not_found") return notFound("Vet or pet not found");
  if (result.code === "species_not_accepted") {
    return badRequest(`This vet doesn't treat ${result.species}s`);
  }
  return badRequest("This vet doesn't offer that kind of consultation");
}
