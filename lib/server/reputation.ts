/**
 * Derived reputation for the two professional profiles.
 *
 * `rating`, `reviewCount` and `responseRatePct` are shown on cards, profiles
 * and dashboards, and none of them are things a professional may type in — the
 * vet and caretaker patch schemas refuse all three. This module is the only
 * place that writes them.
 *
 * Caretakers and vets carry identical reputation fields but live in different
 * tables and take requests from different tables. That fork is confined to the
 * three helpers at the top; everything below is written once.
 */

import type { PrismaClient } from "@prisma/client";

/**
 * Which side of the marketplace is being scored.
 *
 * Shelters are here for `responseRatePct` only — they have no `rating` or
 * `reviewCount` columns, deliberately, until `Review.kind` grows an "adoption"
 * arm. `applyRating` no-ops for them, which it already did for anyone without a
 * profile.
 */
export type Professional = "caretaker" | "vet" | "shelter";

type ProfileRef = { id: string } | { userId: string };

interface ProfileRow {
  id: string;
  rating: number;
  reviewCount: number;
}

function loadProfile(
  kind: Professional,
  where: ProfileRef,
  db: PrismaClient
): Promise<ProfileRow | null> {
  // A shelter has no rating to load. Returning null here is what makes
  // `applyRating` a no-op for them without a second branch.
  if (kind === "shelter") return Promise.resolve(null);
  return kind === "vet"
    ? db.vetProfile.findUnique({ where })
    : db.caretakerProfile.findUnique({ where });
}

async function patchProfile(
  kind: Professional,
  id: string,
  data: Partial<{ rating: number; reviewCount: number; responseRatePct: number }>,
  db: PrismaClient
): Promise<void> {
  if (kind === "shelter") {
    await db.shelterProfile.update({ where: { id }, data });
  } else if (kind === "vet") {
    await db.vetProfile.update({ where: { id }, data });
  } else {
    await db.caretakerProfile.update({ where: { id }, data });
  }
}

/**
 * A request counts as answered once the professional has acted on it. The two
 * lifecycles name their first accepting state differently — a booking is
 * `accepted`, an appointment is `confirmed` — but mean the same thing.
 */
const ANSWERED: Record<Professional, string[]> = {
  caretaker: ["accepted", "declined", "in_progress", "completed"],
  vet: ["confirmed", "declined", "in_progress", "completed"],
  shelter: ["under_review", "approved", "rejected", "completed"],
};

/** What is still sitting unanswered, per kind. */
const WAITING: Record<Professional, string> = {
  caretaker: "requested",
  vet: "requested",
  shelter: "submitted",
};

/**
 * How many requests this professional has answered, and how many are still
 * sitting unanswered.
 *
 * Cancelled requests are counted as neither. We store no record of who
 * cancelled or when, so a cancellation could equally mean the professional
 * ignored it or the owner changed their mind an hour later — and guessing
 * would quietly punish people for something they may not have done.
 */
async function requestCounts(
  kind: Professional,
  profileId: string,
  db: PrismaClient
): Promise<{ answered: number; waiting: number }> {
  // One table of accessors rather than a branch per kind. The third kind is
  // what made the if/else version ugly enough to be worth generalising: each
  // arm differs only in which table to count and which column names the
  // profile.
  const count = (statuses: { in: string[] } | string) => {
    if (kind === "vet") {
      return db.vetAppointment.count({
        where: { vetId: profileId, status: statuses },
      });
    }
    if (kind === "shelter") {
      return db.adoptionApplication.count({
        where: { shelterId: profileId, status: statuses },
      });
    }
    return db.booking.count({
      where: { caretakerId: profileId, status: statuses },
    });
  };

  const [answered, waiting] = await Promise.all([
    count({ in: ANSWERED[kind] }),
    count(WAITING[kind]),
  ]);
  return { answered, waiting };
}

/** Share of requests answered, as a whole percentage. */
export function responseRateFrom(answered: number, waiting: number): number {
  const total = answered + waiting;
  // Nobody has asked yet, so nothing has gone unanswered.
  if (total === 0) return 100;
  return Math.round((answered / total) * 100);
}

/**
 * Recompute a professional's response rate from their request history.
 *
 * Called whenever a request arrives or its status moves, which are the only
 * two events that can change the answer.
 */
export async function refreshResponseRate(
  kind: Professional,
  profileId: string,
  db: PrismaClient
): Promise<void> {
  const { answered, waiting } = await requestCounts(kind, profileId, db);
  await patchProfile(
    kind,
    profileId,
    { responseRatePct: responseRateFrom(answered, waiting) },
    db
  );
}

/**
 * Fold a new rating into a professional's headline score.
 *
 * A running average rather than a recount over the Review rows, because the
 * seeded `reviewCount` stands for reputation earned before this database
 * existed. Recounting would wipe a vet's 214 reviews the moment someone left
 * the 215th, which reads as a bug rather than as honesty.
 *
 * Owners get reviewed too and have no professional profile; that is a no-op,
 * not an error.
 */
export async function applyRating(
  kind: Professional,
  userId: string,
  rating: number,
  db: PrismaClient
): Promise<void> {
  const profile = await loadProfile(kind, { userId }, db);
  if (!profile) return;

  const reviewCount = profile.reviewCount + 1;
  const blended = (profile.rating * profile.reviewCount + rating) / reviewCount;

  // Stored at full precision on purpose. Rounding here would be rounding the
  // accumulator: with 127 reviews behind them, each new 1-star moves the mean
  // by ~0.03, which vanishes at one decimal — so the stored value would round
  // back to itself every time and the rating would freeze permanently, however
  // many bad reviews arrived. RatingStars renders it with toFixed(1).
  await patchProfile(kind, profile.id, { rating: blended, reviewCount }, db);
}
