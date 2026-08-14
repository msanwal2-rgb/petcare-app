import { getBookingsByCaretaker } from "@/lib/server/bookings";
import { forbidden, ok } from "@/lib/server/http";
import {
  requireUser,
  ownsCaretakerProfile,
} from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/caretakers/:id/bookings -> Booking[] — only the caretaker themselves
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  if (!(await ownsCaretakerProfile(auth.uid, id))) return forbidden();
  return ok(await getBookingsByCaretaker(id));
}
