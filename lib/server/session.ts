/**
 * Server-side session helpers used by route handlers to enforce authorization.
 * The real security boundary lives here (not in the client store): every write
 * endpoint checks the Auth.js session before touching data.
 */

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

// Re-exported so route handlers can pull auth guards + response helpers from a
// single import site.
export { unauthorized, forbidden } from "./http";

/** The authenticated user's id, or null. */
export async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Is `uid` a participant in this booking — either the owner, or the user who
 * owns the caretaker profile it was booked with?
 */
export async function isBookingParticipant(
  uid: string,
  bookingId: string
): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { ownerId: true, caretakerId: true },
  });
  if (!booking) return false;
  if (booking.ownerId === uid) return true;
  const caretaker = await prisma.caretakerProfile.findUnique({
    where: { id: booking.caretakerId },
    select: { userId: true },
  });
  return caretaker?.userId === uid;
}

/** Does `uid` own the caretaker profile with this id? */
export async function ownsCaretakerProfile(
  uid: string,
  caretakerId: string
): Promise<boolean> {
  const caretaker = await prisma.caretakerProfile.findUnique({
    where: { id: caretakerId },
    select: { userId: true },
  });
  return caretaker?.userId === uid;
}
