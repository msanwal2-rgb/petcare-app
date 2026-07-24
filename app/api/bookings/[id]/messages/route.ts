import { z } from "zod";
import { getBookingById } from "@/lib/server/bookings";
import {
  createMessage,
  getMessagesForBooking,
  markMessagesRead,
} from "@/lib/server/messages";
import { forbidden, notFound, ok, parseBody } from "@/lib/server/http";
import {
  currentUserId,
  ownsCaretakerProfile,
  unauthorized,
} from "@/lib/server/session";

type Ctx = { params: Promise<{ id: string }> };

const messageSchema = z.object({ body: z.string().min(1).max(2000) });

/** Resolve the booking and confirm the caller is a participant. */
async function guard(id: string) {
  const uid = await currentUserId();
  if (!uid) return { res: unauthorized() as Response };
  const booking = await getBookingById(id);
  if (!booking) return { res: notFound(`Booking ${id} not found`) as Response };
  const isOwner = booking.ownerId === uid;
  const isCaretaker = isOwner
    ? false
    : await ownsCaretakerProfile(uid, booking.caretakerId);
  if (!isOwner && !isCaretaker) return { res: forbidden() as Response };
  return { uid };
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
