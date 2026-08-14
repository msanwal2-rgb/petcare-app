import {
  getAppointmentById,
  updateAppointmentStatus,
} from "@/lib/server/appointments";
import { updateAppointmentStatusSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { ownsVetProfile, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/appointments/:id/status -> VetAppointment | 401 | 403 | 404 | 409
// Auth: participants only, and which party you are decides what you may do —
// an owner can cancel, only the vet can confirm, decline, start or complete.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const appointment = await getAppointmentById(id);
  if (!appointment) return notFound(`Appointment ${id} not found`);

  const isOwner = appointment.ownerId === auth.uid;
  const isVet = isOwner ? false : await ownsVetProfile(auth.uid, appointment.vetId);
  if (!isOwner && !isVet) return forbidden();

  const parsed = await parseBody(request, updateAppointmentStatusSchema);
  if ("response" in parsed) return parsed.response;

  const result = await updateAppointmentStatus(
    id,
    parsed.data.status,
    isOwner ? "owner" : "vet"
  );
  if (result.ok) return ok(result.appointment);
  if (result.code === "not_found") return notFound(`Appointment ${id} not found`);
  if (result.code === "not_allowed") {
    return forbidden(
      result.actor === "owner"
        ? "Only the vet can make that change"
        : "Only the pet's owner can make that change"
    );
  }
  return error(
    `Cannot change appointment status from "${result.from}" to "${result.to}"`,
    409,
    { from: result.from, to: result.to }
  );
}
