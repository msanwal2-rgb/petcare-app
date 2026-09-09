import { getBookingById, updateBookingStatus } from "@/lib/server/bookings";
import { updateBookingStatusSchema } from "@/lib/validation/schemas";
import { error, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import {
  requireUser,
  ownsCaretakerProfile,
} from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/bookings/:id/status -> Booking | 401 | 403 | 404 | 409
// Auth: only a participant (owner or the caretaker) can change status.
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const booking = await getBookingById(id);
  if (!booking) return notFound(`Booking ${id} not found`);
  const isOwner = booking.ownerId === auth.uid;
  const isCaretaker = isOwner
    ? false
    : await ownsCaretakerProfile(auth.uid, booking.caretakerId);
  if (!isOwner && !isCaretaker) return forbidden();

  const parsed = await parseBody(request, updateBookingStatusSchema);
  if ("response" in parsed) return parsed.response;

  // Which party is asking, derived from the session rather than the body — the
  // same shape the appointment route has always used.
  const result = await updateBookingStatus(
    id,
    parsed.data.status,
    undefined,
    isOwner ? "owner" : "caretaker"
  );
  if (result.ok) return ok(result.booking);
  if (result.code === "not_found") return notFound(`Booking ${id} not found`);
  if (result.code === "wrong_actor") {
    return forbidden(
      result.actor === "owner"
        ? "Only the caretaker can do that"
        : "Only the owner can do that"
    );
  }
  return error(
    `Cannot change booking status from "${result.from}" to "${result.to}"`,
    409,
    { from: result.from, to: result.to }
  );
}
