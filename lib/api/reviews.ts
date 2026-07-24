/**
 * Reviews domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Review } from "@/types";
import { db, delay, nextId } from "./_db";

/**
 * GET /api/users/:userId/reviews          (reviews written ABOUT this user)
 * 200 -> Review[]  (newest first)
 * Used on: /caretaker/[id] (caretaker's reviews), profile pages
 */
export async function getReviewsForUser(userId: string): Promise<Review[]> {
  return delay(
    db.reviews
      .filter((r) => r.toUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
}

/**
 * GET /api/bookings/:bookingId/reviews
 * 200 -> Review[]
 * Used on: /booking/[id] (post-completion reviews)
 */
export async function getReviewsForBooking(
  bookingId: string
): Promise<Review[]> {
  return delay(db.reviews.filter((r) => r.bookingId === bookingId));
}

/**
 * POST /api/bookings/:bookingId/reviews
 * Body: { fromUserId, toUserId, rating, comment }
 * 201 -> Review
 * Used on: /booking/[id] (leave a review after completion)
 */
export async function createReview(input: {
  bookingId: string;
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string;
}): Promise<Review> {
  const review: Review = {
    ...input,
    id: nextId("r"),
    createdAt: "2026-07-08T12:00:00Z",
  };
  db.reviews.push(review);
  return delay(review);
}
