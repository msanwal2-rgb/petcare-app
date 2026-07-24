/**
 * Reviews domain — server logic.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toReview } from "./serialize";
import { genId, nowIso } from "./ids";
import type { CreateReviewBody } from "@/lib/validation/schemas";

export async function getReviewsForUser(userId: string, db: PrismaClient = defaultPrisma) {
  const rows = await db.review.findMany({
    where: { toUserId: userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toReview);
}

export async function getReviewsForBooking(bookingId: string, db: PrismaClient = defaultPrisma) {
  const rows = await db.review.findMany({ where: { bookingId } });
  return rows.map(toReview);
}

export async function createReview(
  bookingId: string,
  input: CreateReviewBody,
  db: PrismaClient = defaultPrisma
) {
  const r = await db.review.create({
    data: {
      ...input,
      id: genId("r"),
      bookingId,
      createdAt: nowIso(),
    },
  });
  return toReview(r);
}
