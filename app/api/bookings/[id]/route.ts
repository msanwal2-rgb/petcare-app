import { getBookingById } from "@/lib/server/bookings";
import { forbidden, notFound, ok } from "@/lib/server/http";
import { isBookingParticipant, requireUser } from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id -> Booking | 404 — participants only (owner or caretaker)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const booking = await getBookingById(id);
  if (!booking) return notFound(`Booking ${id} not found`);
  if (!(await isBookingParticipant(auth.uid, id))) return forbidden();
  return ok(booking);
}
