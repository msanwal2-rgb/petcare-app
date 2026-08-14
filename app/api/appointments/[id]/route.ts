import { getAppointmentById } from "@/lib/server/appointments";
import { forbidden, notFound, ok } from "@/lib/server/http";
import { isAppointmentParticipant, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/appointments/:id -> VetAppointment | 401 | 403 | 404
// Auth: participants only (the pet's owner, or the vet it was booked with).
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const appointment = await getAppointmentById(id);
  if (!appointment) return notFound(`Appointment ${id} not found`);
  if (!(await isAppointmentParticipant(auth.uid, id))) return forbidden();
  return ok(appointment);
}
