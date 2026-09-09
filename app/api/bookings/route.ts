import { createBooking } from "@/lib/server/bookings";
import { createBookingSchema } from "@/lib/validation/schemas";
import { badRequest, forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

// POST /api/bookings -> Booking (201, status=requested)
//
// Auth: must be signed in and can only book as yourself. The body says what the
// customer wants, never what it costs — the server prices it from the
// caretaker's rate card, the same way the store re-prices a cart and an
// appointment takes its fee from the vet's profile.
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const parsed = await parseBody(request, createBookingSchema);
  if ("response" in parsed) return parsed.response;
  if (parsed.data.ownerId !== auth.uid) return forbidden();

  const result = await createBooking(parsed.data);
  if (result.ok) return ok(result.booking, 201);

  if (result.code === "caretaker_not_found") return notFound("No such caretaker");
  if (result.code === "service_not_offered") {
    return badRequest("That caretaker doesn't offer this service");
  }
  return badRequest("The end of a booking has to come after its start");
}
