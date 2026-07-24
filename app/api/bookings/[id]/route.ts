import { getBookingById } from "@/lib/server/bookings";
import { forbidden, notFound, ok } from "@/lib/server/http";
import {
  currentUserId,
  ownsCaretakerProfile,
  unauthorized,
} from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/bookings/:id -> Booking | 404 — participants only (owner or caretaker)
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const booking = await getBookingById(id);
  if (!booking) return notFound(`Booking ${id} not found`);
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  const isOwner = booking.ownerId === uid;
  const isCaretaker = isOwner
    ? false
    : await ownsCaretakerProfile(uid, booking.caretakerId);
  if (!isOwner && !isCaretaker) return forbidden();
  return ok(booking);
}
