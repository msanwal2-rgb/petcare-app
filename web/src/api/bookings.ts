import type { Booking, BookingStatus, Message, Review, ServiceType } from "@/types";
import { getJson, postJson, patchJson, qs } from "./_client";

/**
 * Bookings, their messages and their reviews — API client.
 *
 * ── There is no price here, and no owner ──
 *
 * `CreateBookingInput` carries neither. The server reads the caretaker's rate
 * card and multiplies by the duration, and takes the owner from the session.
 * The running total a booking form shows is an estimate for the customer; if it
 * ever disagrees with what comes back, the rate card is right.
 */

export interface BookingPage {
  items: Booking[];
  nextCursor: string | null;
}

export interface CreateBookingInput {
  caretakerId: string;
  petIds: string[];
  serviceType: ServiceType;
  startDateTime: string;
  endDateTime: string;
  notes?: string;
}

/**
 * A list read. Without `from` it is newest first by when it was requested.
 * With `from` it is a window of the calendar, soonest first: everything not
 * over before `from` and, given `to`, starting before it — so a stay that
 * began yesterday is in today's window. `status` (comma-separated) filters it.
 */
export interface BookingListParams {
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
}

/** GET /bookings -> the caller's own bookings as an owner, newest first. */
export function listMyBookings(params: BookingListParams = {}): Promise<BookingPage> {
  return getJson<BookingPage>(`/bookings${qs({ ...params })}`);
}

/** GET /caretakers/:id/bookings -> that caretaker's queue. Theirs alone. */
export function listCaretakerBookings(
  caretakerId: string,
  params: BookingListParams = {},
): Promise<BookingPage> {
  return getJson<BookingPage>(`/caretakers/${caretakerId}/bookings${qs({ ...params })}`);
}

/** GET /bookings/:id -> either party only; 404 to anyone else. */
export function getBooking(id: string): Promise<Booking> {
  return getJson<Booking>(`/bookings/${id}`);
}

/** POST /bookings -> Booking (201). */
export function createBooking(input: CreateBookingInput): Promise<Booking> {
  return postJson<Booking>("/bookings", input);
}

/**
 * PATCH /bookings/:id/status.
 *
 * Throws `ApiError` 409 when the move is not legal from where the booking is,
 * and 403 when it is legal but the caller is the wrong party — an owner cannot
 * accept their own booking. The two are different failures on purpose.
 */
export function updateBookingStatus(
  id: string,
  status: BookingStatus,
): Promise<Booking> {
  return patchJson<Booking>(`/bookings/${id}/status`, { status });
}

/* ── Messages ────────────────────────────────────────────────────────── */

/** GET /bookings/:id/messages -> the thread, oldest first. Marks nothing read. */
export function getMessages(bookingId: string): Promise<Message[]> {
  return getJson<Message[]>(`/bookings/${bookingId}/messages`);
}

/** POST /bookings/:id/messages -> Message (201). */
export function sendMessage(bookingId: string, body: string): Promise<Message> {
  return postJson<Message>(`/bookings/${bookingId}/messages`, { body });
}

/**
 * POST /bookings/:id/messages/read -> how many messages moved.
 *
 * Explicit, and never a side effect of reading the thread. The reference
 * implementation marked messages read inside the GET that returned them, which
 * meant an unread inbound message could never be observed by anyone — so no
 * unread badge could ever be right.
 */
export function markMessagesRead(bookingId: string): Promise<{ marked: number }> {
  return postJson<{ marked: number }>(`/bookings/${bookingId}/messages/read`, {});
}

/* ── Reviews ─────────────────────────────────────────────────────────── */

/** GET /bookings/:id/reviews -> both directions. Participants only. */
export function getBookingReviews(bookingId: string): Promise<Review[]> {
  return getJson<Review[]>(`/bookings/${bookingId}/reviews`);
}

/**
 * POST /bookings/:id/reviews -> Review (201).
 *
 * Only after the booking is completed, only by one of the two parties, only
 * about the other one, and only once each.
 */
export function createBookingReview(
  bookingId: string,
  input: { toUserId: string; rating: number; comment?: string },
): Promise<Review> {
  return postJson<Review>(`/bookings/${bookingId}/reviews`, input);
}
