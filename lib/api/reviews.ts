/**
 * Reviews domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Review, ReviewKind } from "@/types";
import { getJson, postJson, qs } from "./_client";

/**
 * GET /api/users/:userId/reviews -> Review[] (about this user, newest first)
 * Pass `kind` to separate their caretaker reviews from their vet reviews.
 */
export async function getReviewsForUser(
  userId: string,
  kind?: ReviewKind
): Promise<Review[]> {
  return getJson<Review[]>(`/api/users/${userId}/reviews${qs({ kind })}`);
}

/** GET /api/bookings/:bookingId/reviews -> Review[] */
export async function getReviewsForBooking(bookingId: string): Promise<Review[]> {
  return getJson<Review[]>(`/api/bookings/${bookingId}/reviews`);
}

/** GET /api/appointments/:appointmentId/reviews -> Review[] */
export async function getReviewsForAppointment(
  appointmentId: string
): Promise<Review[]> {
  return getJson<Review[]>(`/api/appointments/${appointmentId}/reviews`);
}

/** What the author supplies; who may review whom is settled on the server. */
export interface ReviewInput {
  fromUserId: string;
  toUserId: string;
  rating: number;
  comment: string;
}

/** POST /api/bookings/:bookingId/reviews -> Review (201) */
export async function createBookingReview(
  bookingId: string,
  input: ReviewInput
): Promise<Review> {
  return postJson<Review>(`/api/bookings/${bookingId}/reviews`, input);
}

/** POST /api/appointments/:appointmentId/reviews -> Review (201) */
export async function createAppointmentReview(
  appointmentId: string,
  input: ReviewInput
): Promise<Review> {
  return postJson<Review>(`/api/appointments/${appointmentId}/reviews`, input);
}
