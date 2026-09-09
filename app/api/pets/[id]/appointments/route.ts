import { getClinicalAppointmentsByPet } from "@/lib/server/appointments";
import { notFound, ok } from "@/lib/server/http";
import { canViewPet, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/pets/:id/appointments -> (VetAppointment | ClinicalAppointment)[]
//
// This animal's visit history, scoped by the pet rather than by whoever booked
// it. The health record panel used to ask `/api/owners/:ownerId/appointments`
// and filter client-side, which is self-only — so a treating vet opening a
// patient's record got a 403 and an empty panel, before adoption existed to
// make it worse.
//
// Guarded by `canViewPet`, so the people who may see the animal may see its
// history: its owner, a caretaker with a live booking, a treating vet. A pet
// the caller may not see reads as 404 rather than 403, matching
// `GET /api/pets/:id`, so ids cannot be probed.
//
// Anyone who is not the booker of a given visit gets it without the fee.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await canViewPet(auth.uid, id))) return notFound(`Pet ${id} not found`);

  return ok(await getClinicalAppointmentsByPet(id, auth.uid));
}
