import { createBooking } from "@/lib/server/bookings";
import { createBookingSchema } from "@/lib/validation/schemas";
import { ok, parseBody } from "@/lib/server/http";

// POST /api/bookings -> Booking (201, status=requested)
export async function POST(request: Request) {
  const parsed = await parseBody(request, createBookingSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await createBooking(parsed.data), 201);
}
