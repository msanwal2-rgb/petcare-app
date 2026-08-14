import { createBooking } from "@/lib/server/bookings";
import { createBookingSchema } from "@/lib/validation/schemas";
import { forbidden, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// POST /api/bookings -> Booking (201, status=requested)
// Auth: must be signed in and can only book as yourself.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(request, createBookingSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.ownerId !== auth.uid) return forbidden();
  return ok(await createBooking(parsed.data), 201);
}
