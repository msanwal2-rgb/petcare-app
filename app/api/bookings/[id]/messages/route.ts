import { z } from "zod";
import { getBookingById } from "@/lib/server/bookings";
import {
  createMessage,
  getMessagesForBooking,
  markMessagesRead,
} from "@/lib/server/messages";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import {
  isBookingParticipant,
  requireUser,
} from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

const messageSchema = z.object({ body: z.string().min(1).max(2000) });

/** Resolve the booking and confirm the caller is a participant. */
async function guard(id: string) {
  const auth = await requireUser();
  if ("response" in auth) return { res: auth.response };
  const booking = await getBookingById(id);
  if (!booking) return { res: notFound(`Booking ${id} not found`) as Response };
  if (!(await isBookingParticipant(auth.uid, id))) {
    return { res: forbidden() as Response };
  }
  return { uid: auth.uid };
}

// GET /api/bookings/:id/messages -> Message[] (oldest first); marks incoming read
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  await markMessagesRead(id, g.uid);
  return ok(await getMessagesForBooking(id));
}

// POST /api/bookings/:id/messages -> Message (201)
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const parsed = await parseBody(request, messageSchema);
  if ("response" in parsed) return parsed.response;
  return ok(await createMessage(id, g.uid, parsed.data.body), 201);
}
