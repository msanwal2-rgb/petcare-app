/**
 * Authorization predicates: "may this user touch this record?"
 *
 * Split out of session.ts deliberately. These are pure database lookups — they
 * take a user id that the caller has already established and answer a yes/no
 * about a row. `requireUser`, which *establishes* that id, needs the Auth.js
 * request context and therefore drags `next-auth` and `next/server` in with it.
 * Anything importing that transitively cannot run outside a Next request, which
 * put these checks out of reach of the unit suite even though they are the most
 * security-sensitive code in the app.
 *
 * Keeping them here means they can be exercised directly against the isolated
 * `test` schema, with a real database and real fixtures. The assistant's tool
 * layer leans on every one of them, so being able to test them was the point.
 *
 * Each takes an injectable PrismaClient as its trailing argument, matching the
 * convention in the rest of lib/server.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";

/** Is this user store operations staff? Gates fulfillment endpoints. */
export async function isOps(
  uid: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const user = await db.user.findUnique({
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
  bookingId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { ownerId: true, caretakerId: true },
  });
  if (!booking) return false;
  if (booking.ownerId === uid) return true;
  const caretaker = await db.caretakerProfile.findUnique({
    where: { id: booking.caretakerId },
    select: { userId: true },
  });
  return caretaker?.userId === uid;
}

/** Does `uid` own the caretaker profile with this id? */
export async function ownsCaretakerProfile(
  uid: string,
  caretakerId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const caretaker = await db.caretakerProfile.findUnique({
    where: { id: caretakerId },
    select: { userId: true },
  });
  return caretaker?.userId === uid;
}

/* ── Vet care ─────────────────────────────────────────────────────────── */

/** Does `uid` own the vet profile with this id? */
export async function ownsVetProfile(
  uid: string,
  vetId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const vet = await db.vetProfile.findUnique({
    where: { id: vetId },
    select: { userId: true },
  });
  return vet?.userId === uid;
}

/** Does `uid` own this pet? */
export async function ownsPet(
  uid: string,
  petId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const pet = await db.pet.findUnique({
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
  appointmentId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const appointment = await db.vetAppointment.findUnique({
    where: { id: appointmentId },
    select: { ownerId: true, vetId: true },
  });
  if (!appointment) return false;
  if (appointment.ownerId === uid) return true;
  return ownsVetProfile(uid, appointment.vetId, db);
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
  petId: string,
  db: PrismaClient = defaultPrisma,
): Promise<{ allowed: boolean; asVetId: string | null }> {
  if (await ownsPet(uid, petId, db)) return { allowed: true, asVetId: null };

  const vet = await db.vetProfile.findUnique({
    where: { userId: uid },
    select: { id: true },
  });
  if (!vet) return { allowed: false, asVetId: null };

  const treating = await db.vetAppointment.findFirst({
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
