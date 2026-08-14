import { getAppointmentsByOwner } from "@/lib/server/appointments";
import { forbidden, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/appointments -> VetAppointment[]
// Auth: your own appointments only.
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (auth.uid !== ownerId) return forbidden();
  return ok(await getAppointmentsByOwner(ownerId));
}
