/**
 * Reviews domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Review } from "@/types";
import { getJson, postJson } from "./_client";

/** GET /api/users/:userId/reviews -> Review[] (about this user, newest first) */
export async function getReviewsForUser(userId: string): Promise<Review[]> {
  return getJson<Review[]>(`/api/users/${userId}/reviews`);
}

/** GET /api/bookings/:bookingId/reviews -> Review[] */
export async function getReviewsForBooking(
  bookingId: string
): Promise<Review[]> {
  return getJson<Review[]>(`/api/bookings/${bookingId}/reviews`);
}

/** POST /api/bookings/:bookingId/reviews -> Review (201) */
export async function createReview(input: {
  bookingId: string;
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string;
}): Promise<Review> {
  const { bookingId, ...body } = input;
  return postJson<Review>(`/api/bookings/${bookingId}/reviews`, body);
}
