import { createBooking } from "@/lib/server/bookings";
import { createBookingSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { currentUserId, unauthorized } from "@/lib/server/session";

// POST /api/bookings -> Booking (201, status=requested)
// Auth: must be signed in and can only book as yourself.
export async function POST(request: Request) {
  const uid = await currentUserId();
  if (!uid) return unauthorized();
  const parsed = await parseBody(request, createBookingSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.ownerId !== uid) return forbidden();
  return ok(await createBooking(parsed.data), 201);
}
