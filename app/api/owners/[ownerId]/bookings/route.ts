import { getBookingsByOwner } from "@/lib/server/bookings";
import { ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/bookings -> Booking[] (newest first)
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  return ok(await getBookingsByOwner(ownerId));
}
