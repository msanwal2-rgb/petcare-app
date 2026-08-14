/**
 * Server-side session helpers used by route handlers to enforce authorization.
 * The real security boundary lives here (not in the client store): every write
 * endpoint checks the Auth.js session before touching data.
 */

import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";
import { forbidden, unauthorized } from "./http";

// Re-exported so route handlers can pull auth guards + response helpers from a
// single import site.
export { unauthorized, forbidden };

/** The authenticated user's id, or null. Route handlers use requireUser. */
async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * The signed-in user's id, or a ready-made 401 — same either/or shape as
 * `parseBody`, so a handler opens with two lines instead of four:
 *
 *   const auth = await requireUser();
 *   if ("response" in auth) return auth.response;
 */
export async function requireUser(): Promise<
  { uid: string } | { response: Response }
> {
  const uid = await currentUserId();
  return uid ? { uid } : { response: unauthorized() };
}

/** Is this user store operations staff? Gates fulfillment endpoints. */
export async function isOps(uid: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: uid },
    select: { isOps: true },
  });
  return user?.isOps ?? false;
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

/* ── Vet care ─────────────────────────────────────────────────────────── */

/** Does `uid` own the vet profile with this id? */
export async function ownsVetProfile(
  uid: string,
  vetId: string
): Promise<boolean> {
  const vet = await prisma.vetProfile.findUnique({
    where: { id: vetId },
    select: { userId: true },
  });
  return vet?.userId === uid;
}

/** Does `uid` own this pet? */
export async function ownsPet(uid: string, petId: string): Promise<boolean> {
  const pet = await prisma.pet.findUnique({
    where: { id: petId },
    select: { ownerId: true },
  });
  return pet?.ownerId === uid;
}

/**
 * Is `uid` a participant in this appointment — either the pet's owner, or the
 * user behind the vet profile it was booked with?
 */
export async function isAppointmentParticipant(
  uid: string,
  appointmentId: string
): Promise<boolean> {
  const appointment = await prisma.vetAppointment.findUnique({
    where: { id: appointmentId },
    select: { ownerId: true, vetId: true },
  });
  if (!appointment) return false;
  if (appointment.ownerId === uid) return true;
  return ownsVetProfile(uid, appointment.vetId);
}

/**
 * May `uid` read this pet's health record? The owner always may; a vet may
 * once they have an appointment for the pet that wasn't declined or cancelled
 * — treating someone's animal is what earns access to its history, and it ends
 * there. Returns the caller's vet profile id when access is via that route, so
 * write endpoints can stamp records without a second lookup.
 */
export async function canAccessPetRecords(
  uid: string,
  petId: string
): Promise<{ allowed: boolean; asVetId: string | null }> {
  if (await ownsPet(uid, petId)) return { allowed: true, asVetId: null };

  const vet = await prisma.vetProfile.findUnique({
    where: { userId: uid },
    select: { id: true },
  });
  if (!vet) return { allowed: false, asVetId: null };

  const treating = await prisma.vetAppointment.findFirst({
    where: {
      petId,
      vetId: vet.id,
      status: { notIn: ["declined", "cancelled"] },
    },
    select: { id: true },
  });
  return treating
    ? { allowed: true, asVetId: vet.id }
    : { allowed: false, asVetId: null };
}
