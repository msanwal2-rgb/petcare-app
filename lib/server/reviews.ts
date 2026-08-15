/**
 * Reviews — server logic, shared by caretaker bookings and vet appointments.
 *
 * One table serves both. The `bookingId` column holds whichever subject the
 * review is about, and `kind` says which — so a vet's reviews and a
 * caretaker's can never be mistaken for each other even when one person is
 * both.
 *
 * The two differ in direction on purpose. A booking is reviewed **both ways**:
 * an owner and a caretaker each judge how the other behaved. A vet visit is
 * reviewed **one way only** — a clinician rating the client would be a
 * different and much worse product.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toReview } from "./serialize";
import { genId, nowIso } from "./ids";
import type { ReviewKind } from "@/types";
import type { CreateReviewBody } from "@/lib/validation/schemas";

export async function getReviewsForUser(
  userId: string,
  kind?: ReviewKind,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.review.findMany({
    where: { toUserId: userId, ...(kind ? { kind } : {}) },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toReview);
}

/** Reviews of one booking or one appointment. */
export async function getReviewsForSubject(
  subjectId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.review.findMany({
    where: { bookingId: subjectId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toReview);
}

export type CreateReviewResult =
  | { ok: true; review: ReturnType<typeof toReview> }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_completed" }
  | { ok: false; code: "not_a_participant" }
  | { ok: false; code: "wrong_recipient" }
  | { ok: false; code: "already_reviewed" };

/**
 * Who may review what, resolved from the subject itself rather than trusted
 * from the request. Returns the set of author→recipient pairs this subject
 * permits, or null if it isn't reviewable yet.
 */
async function permittedPairs(
  subjectId: string,
  kind: ReviewKind,
  db: PrismaClient
): Promise<{ from: string; to: string }[] | null | "not_found"> {
  if (kind === "vet_appointment") {
    const appointment = await db.vetAppointment.findUnique({
      where: { id: subjectId },
      select: { ownerId: true, vetId: true, status: true },
    });
    if (!appointment) return "not_found";
    if (appointment.status !== "completed") return null;
    const vet = await db.vetProfile.findUnique({
      where: { id: appointment.vetId },
      select: { userId: true },
    });
    if (!vet) return "not_found";
    // One direction only: the pet's owner reviews the vet.
    return [{ from: appointment.ownerId, to: vet.userId }];
  }

  const booking = await db.booking.findUnique({
    where: { id: subjectId },
    select: { ownerId: true, caretakerId: true, status: true },
  });
  if (!booking) return "not_found";
  if (booking.status !== "completed") return null;
  const caretaker = await db.caretakerProfile.findUnique({
    where: { id: booking.caretakerId },
    select: { userId: true },
  });
  if (!caretaker) return "not_found";
  return [
    { from: booking.ownerId, to: caretaker.userId },
    { from: caretaker.userId, to: booking.ownerId },
  ];
}

/**
 * Post a review.
 *
 * Everything the client sends is re-derived from the subject: who took part,
 * whether it finished, and who the review can be about. Before this, any
 * signed-in user could post unlimited reviews about anyone, for a booking they
 * had nothing to do with and that had never happened.
 */
export async function createReview(
  subjectId: string,
  kind: ReviewKind,
  input: CreateReviewBody,
  db: PrismaClient = defaultPrisma
): Promise<CreateReviewResult> {
  const pairs = await permittedPairs(subjectId, kind, db);
  if (pairs === "not_found") return { ok: false, code: "not_found" };
  if (pairs === null) return { ok: false, code: "not_completed" };

  const asAuthor = pairs.filter((p) => p.from === input.fromUserId);
  if (asAuthor.length === 0) return { ok: false, code: "not_a_participant" };
  if (!asAuthor.some((p) => p.to === input.toUserId)) {
    return { ok: false, code: "wrong_recipient" };
  }

  const existing = await db.review.findFirst({
    where: { bookingId: subjectId, fromUserId: input.fromUserId },
    select: { id: true },
  });
  if (existing) return { ok: false, code: "already_reviewed" };

  const row = await db.review.create({
    data: {
      ...input,
      id: genId("r"),
      bookingId: subjectId,
      kind,
      createdAt: nowIso(),
    },
  });

  await applyRatingToProfile(kind, input.toUserId, input.rating, db);
  return { ok: true, review: toReview(row) };
}

/**
 * Fold a new rating into the recipient's headline score.
 *
 * A running average rather than a recount over the Review rows, because the
 * seeded `reviewCount` stands for reputation earned before this database
 * existed. Recounting would wipe a vet's 214 reviews the moment someone left
 * the 215th, which reads as a bug rather than as honesty.
 */
async function applyRatingToProfile(
  kind: ReviewKind,
  toUserId: string,
  rating: number,
  db: PrismaClient
): Promise<void> {
  const profile =
    kind === "vet_appointment"
      ? await db.vetProfile.findUnique({ where: { userId: toUserId } })
      : await db.caretakerProfile.findUnique({ where: { userId: toUserId } });
  // Owners are reviewed too, and they have no professional profile to update.
  if (!profile) return;

  const count = profile.reviewCount + 1;
  const blended = (profile.rating * profile.reviewCount + rating) / count;
  // One decimal — the precision every rating in the UI is rendered at.
  const next = { rating: Math.round(blended * 10) / 10, reviewCount: count };

  if (kind === "vet_appointment") {
    await db.vetProfile.update({ where: { id: profile.id }, data: next });
  } else {
    await db.caretakerProfile.update({ where: { id: profile.id }, data: next });
  }
}
