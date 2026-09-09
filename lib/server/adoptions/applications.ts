/**
 * Adoption applications — server logic.
 *
 * The status machine follows `lib/server/appointments.ts`, which is the newer
 * and tidier of the two the app already has: the actor is a required argument
 * rather than an optional fourth one, and a same-status write returns early
 * instead of falling through the transition check.
 *
 * Like every other machine here, two questions are asked separately and both
 * are enforced: TRANSITIONS says what is reachable, ACTOR_ALLOWED says who may
 * do it.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toAdoptionApplication, toPublicUser } from "../serialize";
import { genId, nowIso } from "../ids";
import { notify } from "../notifications";
import { refreshResponseRate } from "../reputation";
import { refundAdoptionFee } from "./payment";
import type {
  AdoptionApplication,
  AdoptionApplicationWithApplicant,
  ApplicationStatus,
  NotificationKind,
  PaymentStatus,
} from "@/types";
import type { AdoptionApplicationBody } from "@/lib/validation/schemas";

const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  submitted: ["under_review", "rejected", "withdrawn"],
  under_review: ["approved", "rejected", "withdrawn"],
  // `completed` is reached through the transfer command, not a status write —
  // it moves an animal and takes money, and a PATCH would hide that.
  approved: ["completed", "rejected", "withdrawn"],
  completed: [],
  rejected: [],
  withdrawn: [],
};

export type ApplicationActor = "applicant" | "shelter";

/**
 * The shelter decides; the applicant may only walk away.
 *
 * `completed` is listed as the shelter's because the handover is theirs to
 * record — but it is not reachable from this function at all. See
 * `completeAdoption` in ./transfer.
 */
const ACTOR_ALLOWED: Record<ApplicationStatus, ApplicationActor[]> = {
  submitted: [],
  under_review: ["shelter"],
  approved: ["shelter"],
  rejected: ["shelter"],
  withdrawn: ["applicant"],
  completed: ["shelter"],
};

/** What the applicant hears. The shelter watches its own queue. */
const APPLICATION_NOTICES: Partial<
  Record<ApplicationStatus, (petName: string) => { kind: NotificationKind; title: string; body: string }>
> = {
  under_review: (petName) => ({
    kind: "adoption_under_review",
    title: `Your application for ${petName} is being reviewed`,
    body: "The shelter has picked it up. They'll be in touch.",
  }),
  approved: (petName) => ({
    kind: "adoption_approved",
    title: `You've been approved to adopt ${petName}`,
    body: "One step left — settle the adoption fee and arrange collection.",
  }),
  rejected: (petName) => ({
    kind: "adoption_rejected",
    title: `Your application for ${petName} wasn't successful`,
    body: "The shelter has left a note explaining why.",
  }),
};

export type ApplicationResult =
  | { ok: true; application: AdoptionApplication }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "listing_unavailable"; status: string }
  | { ok: false; code: "own_listing" }
  | { ok: false; code: "duplicate" }
  | { ok: false; code: "invalid_transition"; from: ApplicationStatus; to: ApplicationStatus }
  | { ok: false; code: "not_allowed"; actor: ApplicationActor; to: ApplicationStatus }
  | { ok: false; code: "already_approved"; applicationId: string };

/**
 * Apply to adopt.
 *
 * `applicantId` is a parameter rather than a body field, matching
 * `createOrder(userId, …)` and `createAppointment(ownerId, …)` — an identity
 * that decides anything should not arrive in a payload.
 */
export async function createApplication(
  applicantId: string,
  input: AdoptionApplicationBody,
  db: PrismaClient = defaultPrisma
): Promise<ApplicationResult> {
  const listing = await db.adoptionListing.findUnique({
    where: { id: input.listingId },
    include: { pet: { select: { name: true, photoUrl: true } } },
  });
  if (!listing) return { ok: false, code: "not_found" };

  if (listing.status !== "available") {
    return { ok: false, code: "listing_unavailable", status: listing.status };
  }

  const shelter = await db.shelterProfile.findUnique({
    where: { id: listing.shelterId },
    select: { userId: true },
  });
  // A shelter applying to adopt its own animal is a data-entry accident, not a
  // use case.
  if (shelter?.userId === applicantId) return { ok: false, code: "own_listing" };

  // One live application per person per animal. Re-applying after a rejection
  // is allowed — circumstances change — but two open at once is noise in the
  // shelter's queue.
  const open = await db.adoptionApplication.findFirst({
    where: {
      listingId: input.listingId,
      applicantId,
      status: { in: ["submitted", "under_review", "approved"] },
    },
  });
  if (open) return { ok: false, code: "duplicate" };

  const now = nowIso();
  const created = await db.adoptionApplication.create({
    data: {
      id: genId("aa"),
      listingId: listing.id,
      shelterId: listing.shelterId,
      petId: listing.petId,
      // Snapshots, so this row still reads as an adoption of a named animal
      // long after the listing is gone.
      petName: listing.pet.name,
      petPhotoUrl: listing.pet.photoUrl,
      applicantId,
      status: "submitted",
      feeCents: listing.feeCents,
      householdAdults: input.householdAdults,
      householdChildren: input.householdChildren,
      hasOtherPets: input.hasOtherPets,
      otherPetsNotes: input.otherPetsNotes ?? "",
      homeType: input.homeType,
      fencedYard: input.fencedYard,
      ownsHome: input.ownsHome,
      hoursAlonePerDay: input.hoursAlonePerDay,
      experience: input.experience ?? "",
      message: input.message ?? "",
      createdAt: now,
      updatedAt: now,
    },
  });

  // A new application is one more thing the shelter has not answered yet.
  await refreshResponseRate("shelter", listing.shelterId, db);

  if (shelter) {
    await notify(
      shelter.userId,
      {
        kind: "adoption_application_received",
        title: `New application for ${listing.pet.name}`,
        body: "Someone would like to adopt. Their answers are in your queue.",
        href: "/dashboard",
      },
      db
    );
  }

  return { ok: true, application: toAdoptionApplication(created) };
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  actor: ApplicationActor,
  note: string | undefined,
  db: PrismaClient = defaultPrisma
): Promise<ApplicationResult> {
  const existing = await db.adoptionApplication.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const from = existing.status as ApplicationStatus;
  if (from === status) {
    return { ok: true, application: toAdoptionApplication(existing) };
  }
  if (!TRANSITIONS[from].includes(status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }
  if (!ACTOR_ALLOWED[status].includes(actor)) {
    return { ok: false, code: "not_allowed", actor, to: status };
  }

  // At most one approved application per listing. Approving a second would put
  // two people through a payment for one animal, and refunding somebody for an
  // animal they were told they could have is a worse experience than waiting.
  if (status === "approved") {
    const rival = await db.adoptionApplication.findFirst({
      where: {
        listingId: existing.listingId,
        status: "approved",
        id: { not: id },
      },
      select: { id: true },
    });
    if (rival) {
      return { ok: false, code: "already_approved", applicationId: rival.id };
    }
  }

  const now = nowIso();
  const updated = await db.adoptionApplication.update({
    where: { id },
    data: {
      status,
      ...(note !== undefined ? { decisionNote: note } : {}),
      decidedAt: now,
      updatedAt: now,
    },
  });

  // Approving takes the animal off the market without adopting it out yet, so
  // nobody else applies while this one is being settled.
  if (status === "approved") {
    await db.adoptionListing.update({
      where: { id: existing.listingId },
      data: { status: "pending", updatedAt: now },
    });
  }
  // Letting go of an approved applicant puts it back.
  if ((status === "rejected" || status === "withdrawn") && from === "approved") {
    await db.adoptionListing.updateMany({
      where: { id: existing.listingId, status: "pending" },
      data: { status: "available", updatedAt: now },
    });

    // If they had already paid, they get it back. Somebody approved to adopt
    // an animal and then told no must not also be out of pocket, and there is
    // no version of "we will sort it out by email" that is acceptable here.
    await refundAdoptionFee(
      id,
      actor === "shelter" ? "shelter" : "system",
      status === "withdrawn"
        ? "Applicant withdrew after approval"
        : "Application rejected after approval",
      db
    );
  }

  await refreshResponseRate("shelter", existing.shelterId, db);

  const told = APPLICATION_NOTICES[status];
  if (told) {
    await notify(
      existing.applicantId,
      { ...told(existing.petName), href: `/adoptions/applications/${id}` },
      db
    );
  }

  return { ok: true, application: toAdoptionApplication(updated) };
}

/* ── Reads ─────────────────────────────────────────────────────── */

export async function getApplicationById(
  id: string,
  db: PrismaClient = defaultPrisma
): Promise<AdoptionApplication | null> {
  const row = await db.adoptionApplication.findUnique({ where: { id } });
  return row ? toAdoptionApplication(row) : null;
}

export async function getApplicationsByApplicant(
  applicantId: string,
  db: PrismaClient = defaultPrisma
): Promise<AdoptionApplication[]> {
  const rows = await db.adoptionApplication.findMany({
    where: { applicantId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toAdoptionApplication);
}

/** The shelter's queue, with who is asking and whether they have paid. */
export async function getApplicationsForShelter(
  shelterId: string,
  status: ApplicationStatus | undefined,
  db: PrismaClient = defaultPrisma
): Promise<AdoptionApplicationWithApplicant[]> {
  const rows = await db.adoptionApplication.findMany({
    where: { shelterId, ...(status ? { status } : {}) },
    include: { applicant: true },
    // Oldest first: this is a queue, and somebody has been waiting.
    orderBy: { createdAt: "asc" },
  });

  const payments = await db.payment.findMany({
    where: { adoptionApplicationId: { in: rows.map((r) => r.id) } },
    select: { adoptionApplicationId: true, status: true },
  });
  const paid = new Map(
    payments.map((p) => [p.adoptionApplicationId!, p.status as PaymentStatus])
  );

  return rows.map((r) => ({
    ...toAdoptionApplication(r),
    applicant: toPublicUser(r.applicant),
    paymentStatus: paid.get(r.id) ?? null,
  }));
}

/** Is `uid` either side of this application? */
export async function isApplicationParticipant(
  uid: string,
  applicationId: string,
  db: PrismaClient = defaultPrisma
): Promise<{ ok: boolean; actor: ApplicationActor | null }> {
  const row = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
    select: { applicantId: true, shelterId: true },
  });
  if (!row) return { ok: false, actor: null };
  if (row.applicantId === uid) return { ok: true, actor: "applicant" };

  const shelter = await db.shelterProfile.findUnique({
    where: { id: row.shelterId },
    select: { userId: true },
  });
  return shelter?.userId === uid
    ? { ok: true, actor: "shelter" }
    : { ok: false, actor: null };
}
