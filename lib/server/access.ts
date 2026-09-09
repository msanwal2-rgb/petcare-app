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

/* ── Staff privileges ─────────────────────────────────────────── */

/**
 * Staff privileges, orthogonal to the marketplace roles in `User.roles`. A
 * caretaker is a kind of customer; a staff member is a kind of employee, and
 * conflating the two is how a marketplace ends up letting a vet read the
 * payments ledger.
 *
 * Four, because they answer four different questions:
 *   ops      — may move parcels (the pre-existing fulfilment console)
 *   support  — may read a customer's account to answer a ticket
 *   finance  — may move money
 *   admin    — may change who is staff, and satisfies every check above
 */
export const STAFF_ROLES = ["ops", "support", "finance", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** Every staff role held by this user. Empty for an ordinary customer. */
export async function staffRoles(
  uid: string,
  db: PrismaClient = defaultPrisma,
): Promise<StaffRole[]> {
  const user = await db.user.findUnique({
    where: { id: uid },
    select: { staffRoles: true },
  });
  return (user?.staffRoles ?? []).filter(isStaffRole);
}

/**
 * Does this user hold `role`? "admin" satisfies every check — stated once here
 * rather than remembered at each of the twenty call sites, which is the version
 * somebody eventually forgets.
 */
export async function hasStaffRole(
  uid: string,
  role: StaffRole,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const held = await staffRoles(uid, db);
  return held.includes("admin") || held.includes(role);
}

/**
 * Is this user store operations staff? Gates fulfillment endpoints.
 *
 * Kept as a named predicate over `hasStaffRole(uid, "ops")` because three route
 * handlers already read this way and the question they ask hasn't changed.
 */
export async function isOps(
  uid: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  return hasStaffRole(uid, "ops", db);
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

/** Does `uid` own the shelter profile with this id? */
export async function ownsShelterProfile(
  uid: string,
  shelterId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const shelter = await db.shelterProfile.findUnique({
    where: { id: shelterId },
    select: { userId: true },
  });
  return shelter?.userId === uid;
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

/**
 * The ownership boundary: who owns this animal, and since when.
 *
 * Loaded once and threaded through the predicates below, which between them
 * used to fetch the same row three times for a single `canViewPet` call.
 */
async function petOwnership(
  petId: string,
  db: PrismaClient,
): Promise<{ ownerId: string; ownedSince: string } | null> {
  return db.pet.findUnique({
    where: { id: petId },
    select: { ownerId: true, ownedSince: true },
  });
}

/** Does `uid` own this pet? */
export async function ownsPet(
  uid: string,
  petId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const pet = await petOwnership(petId, db);
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
 * May `uid` see this pet at all?
 *
 * Distinct from `canAccessPetRecords`, which governs the clinical history. This
 * is the pet as a *booking* sees it — name, breed, feeding instructions,
 * behaviour notes — and the people who need it are the ones looking after the
 * animal: its owner, a caretaker with a live booking for it, or a vet with a
 * live appointment.
 *
 * It exists because `GET /api/pets/:id` used to be entirely public, on the
 * reasoning that a caretaker needs to read it. So does anyone who can count:
 * ids are sequential (`p1`, `p2`, …), and the response carries medications,
 * allergies, behaviour notes and the household's vet's phone number.
 */
export async function canViewPet(
  uid: string,
  petId: string,
  db: PrismaClient = defaultPrisma,
): Promise<boolean> {
  const pet = await petOwnership(petId, db);
  if (!pet) return false;
  if (pet.ownerId === uid) return true;

  const caretaker = await db.caretakerProfile.findUnique({
    where: { userId: uid },
    select: { id: true },
  });
  if (caretaker) {
    const booked = await db.booking.findFirst({
      where: {
        caretakerId: caretaker.id,
        petIds: { has: petId },
        status: { notIn: ["declined", "cancelled"] },
        // Only a booking made under the *current* owner counts. Without this,
        // a sitter who looked after an animal at a shelter would keep reading
        // its medications and its household vet's phone number for as long as
        // the row existed, in someone else's home.
        createdAt: { gte: pet.ownedSince },
      },
      select: { id: true },
    });
    if (booked) return true;
  }

  const { allowed } = await recordAccessFor(uid, petId, pet, db);
  return allowed;
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
  const pet = await petOwnership(petId, db);
  if (!pet) return { allowed: false, asVetId: null };
  return recordAccessFor(uid, petId, pet, db);
}

/** The body of `canAccessPetRecords`, with the pet already loaded. */
async function recordAccessFor(
  uid: string,
  petId: string,
  pet: { ownerId: string; ownedSince: string },
  db: PrismaClient,
): Promise<{ allowed: boolean; asVetId: string | null }> {
  if (pet.ownerId === uid) return { allowed: true, asVetId: null };

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
      // As in `canViewPet`: only an appointment made under the current owner.
      //
      // This one matters more, because record access is *write* access — a vet
      // who kept it could go on writing `prescription` records, and an unexpired
      // prescription is what unlocks Rx products in the store. Without this
      // clause, adopting an animal would hand every vet who ever treated it at
      // the shelter a standing line of credit against the adopter's account.
      createdAt: { gte: pet.ownedSince },
    },
    select: { id: true },
  });
  return treating
    ? { allowed: true, asVetId: vet.id }
    : { allowed: false, asVetId: null };
}
