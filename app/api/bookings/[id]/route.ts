import { getBookingById } from "@/lib/server/bookings";
import { notFound, ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id -> Booking | 404
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const booking = await getBookingById(id);
  return booking ? ok(booking) : notFound(`Booking ${id} not found`);
}
