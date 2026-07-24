import { getBookingsByCaretaker } from "@/lib/server/bookings";
import { ok } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/caretakers/:id/bookings -> Booking[] (newest first)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return ok(await getBookingsByCaretaker(id));
}
