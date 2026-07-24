import { updateBookingStatus } from "@/lib/server/bookings";
import { updateBookingStatusSchema } from "@/lib/validation/schemas";
import { error, notFound, ok, parseBody } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/bookings/:id/status -> Booking | 404 | 409 (invalid transition)
export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = await parseBody(request, updateBookingStatusSchema);
  if ("response" in parsed) return parsed.response;

  const result = await updateBookingStatus(id, parsed.data.status);
  if (result.ok) return ok(result.booking);
  if (result.code === "not_found") return notFound(`Booking ${id} not found`);
  return error(
    `Cannot change booking status from "${result.from}" to "${result.to}"`,
    409,
    { from: result.from, to: result.to }
  );
}
