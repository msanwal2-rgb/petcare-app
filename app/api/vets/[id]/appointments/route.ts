import { getAppointmentsByVet } from "@/lib/server/appointments";
import { forbidden, ok } from "@/lib/server/http";
import { ownsVetProfile, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/vets/:id/appointments -> VetAppointment[]
// Auth: only the vet who owns this profile can see their schedule.
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await ownsVetProfile(auth.uid, id))) return forbidden();
  return ok(await getAppointmentsByVet(id));
}
