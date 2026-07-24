import { getBookingsByOwner } from "@/lib/server/bookings";
import { forbidden, ok } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

type Ctx = { params: Promise<{ ownerId: string }> };

// GET /api/owners/:ownerId/bookings -> Booking[] (newest first) — your own
export async function GET(_request: Request, ctx: Ctx) {
  const { ownerId } = await ctx.params;
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  if (uid !== ownerId) return forbidden();
  return ok(await getBookingsByOwner(ownerId));
}
