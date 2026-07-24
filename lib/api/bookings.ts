/**
 * Bookings domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Booking, BookingStatus, CreateBookingInput } from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson } from "./_client";

/** GET /api/owners/:ownerId/bookings -> Booking[] (newest first) */
export async function getBookingsByOwner(ownerId: string): Promise<Booking[]> {
  return getJson<Booking[]>(`/api/owners/${ownerId}/bookings`);
}

/** GET /api/caretakers/:caretakerId/bookings -> Booking[] (newest first) */
export async function getBookingsByCaretaker(
  caretakerId: string
): Promise<Booking[]> {
  return getJson<Booking[]>(`/api/caretakers/${caretakerId}/bookings`);
}

/** GET /api/bookings/:id -> Booking | null(404) */
export async function getBookingById(id: string): Promise<Booking | null> {
  return getJsonOrNull<Booking>(`/api/bookings/${id}`);
}

/** POST /api/bookings -> Booking (201, status=requested) */
export async function createBooking(
  input: CreateBookingInput
): Promise<Booking> {
  return postJson<Booking>(`/api/bookings`, input);
}

/** PATCH /api/bookings/:id/status -> Booking */
export async function updateBookingStatus(
  id: string,
  status: BookingStatus
): Promise<Booking> {
  return patchJson<Booking>(`/api/bookings/${id}/status`, { status });
}
