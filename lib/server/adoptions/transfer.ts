/**
 * Completing an adoption: the moment an animal changes hands.
 *
 * This is the only place in the application that writes `Pet.ownerId`. The
 * schema-level backdoor that used to allow it from a PATCH is closed, and the
 * reason it had to be is here — moving an animal is not a field edit. It ends
 * one household's access to a health record and begins another's, and it takes
 * money on the way.
 *
 * The single most important line in this file is the conditional `updateMany`
 * in phase 1. Everything else is bookkeeping around it.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toAdoptionApplication, toPet } from "../serialize";
import { nowIso } from "../ids";
import { notify } from "../notifications";
import { updateBookingStatus } from "../bookings";
import { updateAppointmentStatus } from "../appointments";
import type {
  AdoptionApplication,
  ApplicationStatus,
  PaymentStatus,
  Pet,
} from "@/types";

/** Engagements that would straddle the transfer if we let it through. */
const LIVE_BOOKING = ["requested", "accepted", "in_progress"];
const LIVE_APPOINTMENT = ["requested", "confirmed", "in_progress"];

export type CompleteAdoptionResult =
  | { ok: true; application: AdoptionApplication; pet: Pet }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_allowed" }
  | { ok: false; code: "invalid_transition"; from: ApplicationStatus }
  | { ok: false; code: "fee_unpaid"; paymentStatus: PaymentStatus | null }
  | { ok: false; code: "not_shelter_owned"; ownerId: string }
  | {
      ok: false;
      code: "live_engagements";
      bookingIds: string[];
      appointmentIds: string[];
    };

export interface CompleteAdoptionOptions {
  /**
   * Cancel the live engagements standing in the way, rather than refusing.
   *
   * Off by default and deliberately awkward to reach. In this data model a
   * fostered animal *is* a pet under a long boarding booking, so refusing with
   * no way forward would block most real adoptions — but cancelling a sitter's
   * booking out from under them, while the animal is in their house, from a
   * flow they are not party to, is worse than refusing. So the caller has to
   * have seen the ids and decided.
   */
  force?: boolean;
}

export async function completeAdoption(
  applicationId: string,
  actorUserId: string,
  options: CompleteAdoptionOptions = {},
  db: PrismaClient = defaultPrisma,
  now: string = nowIso()
): Promise<CompleteAdoptionResult> {
  /* ── Phase 0: preconditions, all reads ─────────────────────────── */

  const application = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) return { ok: false, code: "not_found" };

  const shelter = await db.shelterProfile.findUnique({
    where: { id: application.shelterId },
    select: { userId: true, name: true },
  });
  if (!shelter) return { ok: false, code: "not_found" };
  // The shelter records the handover, because the shelter is who hands over.
  // The applicant pays; that is a different endpoint.
  if (shelter.userId !== actorUserId) return { ok: false, code: "not_allowed" };

  const from = application.status as ApplicationStatus;
  if (from !== "approved") return { ok: false, code: "invalid_transition", from };

  const pet = await db.pet.findUnique({ where: { id: application.petId } });
  if (!pet) return { ok: false, code: "not_found" };
  // Also the idempotency guard: a double-submit finds the animal already moved
  // and refuses cleanly rather than re-severing a household that has settled in.
  if (pet.ownerId !== shelter.userId) {
    return { ok: false, code: "not_shelter_owned", ownerId: pet.ownerId };
  }

  if (application.feeCents > 0) {
    const payment = await db.payment.findUnique({
      where: { adoptionApplicationId: applicationId },
    });
    if (payment?.status !== "paid") {
      return {
        ok: false,
        code: "fee_unpaid",
        paymentStatus: (payment?.status as PaymentStatus) ?? null,
      };
    }
  }

  const [liveBookings, liveAppointments] = await Promise.all([
    db.booking.findMany({
      where: { petIds: { has: pet.id }, status: { in: LIVE_BOOKING } },
      select: { id: true, ownerId: true, caretakerId: true },
    }),
    db.vetAppointment.findMany({
      where: { petId: pet.id, status: { in: LIVE_APPOINTMENT } },
      select: { id: true, ownerId: true },
    }),
  ]);

  if (liveBookings.length + liveAppointments.length > 0) {
    if (!options.force) {
      // Refusing is the default because the alternative cancels somebody's
      // arrangement without telling them first. The ids go back so the UI can
      // name what is in the way.
      return {
        ok: false,
        code: "live_engagements",
        bookingIds: liveBookings.map((b) => b.id),
        appointmentIds: liveAppointments.map((a) => a.id),
      };
    }

    // Forced: close them through their own status machines, so each writes its
    // own event and notifies its own counterparty. Never a silent UPDATE.
    for (const booking of liveBookings) {
      await updateBookingStatus(booking.id, "cancelled", db);
    }
    for (const appointment of liveAppointments) {
      await updateAppointmentStatus(appointment.id, "cancelled", "owner", db);
    }
  }

  /* ── Phase 1: the atomic core ──────────────────────────────────── */

  let raced = false;
  await db.$transaction(async (tx) => {
    // The whole feature, in one statement.
    //
    // Conditional on the shelter still owning the animal, because phase 0 ran
    // outside this transaction and two concurrent completes could both have
    // passed it. Exactly one of them matches a row here.
    //
    // Moving `ownedSince` with `ownerId` is what severs every caretaker and
    // every vet the shelter had engaged — atomically, with no list of grants to
    // walk and no half-severed state. The health record itself does not move at
    // all: `MedicalRecord` is keyed on `petId`, so it follows the animal by
    // standing still.
    const moved = await tx.pet.updateMany({
      where: { id: pet.id, ownerId: shelter.userId },
      data: { ownerId: application.applicantId, ownedSince: now },
    });
    if (moved.count !== 1) {
      raced = true;
      return;
    }

    await tx.adoptionListing.update({
      where: { id: application.listingId },
      data: { status: "adopted", closedAt: now, updatedAt: now },
    });

    await tx.adoptionApplication.update({
      where: { id: applicationId },
      data: { status: "completed", completedAt: now, updatedAt: now },
    });

    // Everyone else who applied for this animal hears now, rather than being
    // left refreshing a listing that will never come back.
    await tx.adoptionApplication.updateMany({
      where: {
        listingId: application.listingId,
        id: { not: applicationId },
        status: { in: ["submitted", "under_review", "approved"] },
      },
      data: {
        status: "rejected",
        decisionNote: `${application.petName} has been adopted.`,
        decidedAt: now,
        updatedAt: now,
      },
    });
  });

  if (raced) {
    const fresh = await db.pet.findUnique({
      where: { id: pet.id },
      select: { ownerId: true },
    });
    return { ok: false, code: "not_shelter_owned", ownerId: fresh?.ownerId ?? "" };
  }

  /* ── Phase 2: after commit, best-effort ────────────────────────── */

  await notify(
    application.applicantId,
    {
      kind: "adoption_completed",
      title: `${application.petName} is yours`,
      body: `${shelter.name} has completed the adoption. ${application.petName}'s health record has come with them.`,
      href: `/dashboard/pets/${pet.id}`,
    },
    db
  );

  const closed = await db.adoptionApplication.findMany({
    where: {
      listingId: application.listingId,
      id: { not: applicationId },
      status: "rejected",
      decidedAt: now,
    },
    select: { applicantId: true },
  });
  for (const other of closed) {
    await notify(
      other.applicantId,
      {
        kind: "adoption_rejected",
        title: `${application.petName} has found a home`,
        body: "Your application has been closed. There are other animals waiting.",
        href: "/adopt",
      },
      db
    );
  }

  const [updated, movedPet] = await Promise.all([
    db.adoptionApplication.findUnique({ where: { id: applicationId } }),
    db.pet.findUnique({ where: { id: pet.id } }),
  ]);

  return {
    ok: true,
    application: toAdoptionApplication(updated!),
    pet: toPet(movedPet!),
  };
}

/**
 * Put an animal back.
 *
 * Adoptions fall through — the dog is scared of the baby, the allergy turns out
 * to be real. Without this the only tool would be the ownership backdoor this
 * feature closed, which somebody would reopen by hand in production.
 *
 * Staff-only and audited by the caller. Note that it severs in the other
 * direction for free: the *adopter's* caretakers and vets lose access on the
 * same write, because the mechanism has never cared which way an animal moves.
 */
export type ReverseAdoptionResult =
  | { ok: true; pet: Pet }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_completed"; status: ApplicationStatus };

export async function reverseAdoption(
  applicationId: string,
  reason: string,
  db: PrismaClient = defaultPrisma,
  now: string = nowIso()
): Promise<ReverseAdoptionResult> {
  const application = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) return { ok: false, code: "not_found" };

  const status = application.status as ApplicationStatus;
  if (status !== "completed") return { ok: false, code: "not_completed", status };

  const shelter = await db.shelterProfile.findUnique({
    where: { id: application.shelterId },
    select: { userId: true, name: true },
  });
  if (!shelter) return { ok: false, code: "not_found" };

  await db.$transaction(async (tx) => {
    await tx.pet.update({
      where: { id: application.petId },
      data: { ownerId: shelter.userId, ownedSince: now },
    });
    await tx.adoptionListing.updateMany({
      where: { id: application.listingId },
      data: { status: "available", closedAt: null, updatedAt: now },
    });
    await tx.adoptionApplication.update({
      where: { id: applicationId },
      data: {
        status: "rejected",
        decisionNote: reason,
        completedAt: null,
        updatedAt: now,
      },
    });
  });

  await notify(
    application.applicantId,
    {
      kind: "adoption_reversed",
      title: `${application.petName} has returned to ${shelter.name}`,
      body: reason,
      href: "/adopt",
    },
    db
  );

  const pet = await db.pet.findUnique({ where: { id: application.petId } });
  return { ok: true, pet: toPet(pet!) };
}
