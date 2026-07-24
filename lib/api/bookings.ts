/**
 * Bookings domain — API client. See /lib/api/users.ts for the pattern.
 * Booking is the central object (foundation §4): requests, status changes,
 * and cancellations all live here.
 */

import type { Booking, BookingStatus, CreateBookingInput } from "@/types";
import { db, delay, nextId } from "./_db";

/**
 * GET /api/owners/:ownerId/bookings
 * 200 -> Booking[]  (newest first)
 * Used on: /dashboard (owner view)
 */
export async function getBookingsByOwner(ownerId: string): Promise<Booking[]> {
  return delay(
    db.bookings
      .filter((b) => b.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
}

/**
 * GET /api/caretakers/:caretakerId/bookings
 * 200 -> Booking[]  (newest first)
 * Used on: /dashboard (caretaker view — incoming requests + schedule)
 */
export async function getBookingsByCaretaker(
  caretakerId: string
): Promise<Booking[]> {
  return delay(
    db.bookings
      .filter((b) => b.caretakerId === caretakerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
}

/**
 * GET /api/bookings/:id
 * 200 -> Booking
 * 404 -> null
 * Used on: /booking/[id]
 */
export async function getBookingById(id: string): Promise<Booking | null> {
  return delay(db.bookings.find((b) => b.id === id) ?? null);
}

/**
 * POST /api/bookings
 * Body: CreateBookingInput
 * 201 -> Booking  (status defaults to "requested")
 * Used on: /booking/new (submit request)
 */
export async function createBooking(
  input: CreateBookingInput
): Promise<Booking> {
  const booking: Booking = {
    ...input,
    id: nextId("b"),
    status: "requested",
    // createdAt is fixed to the demo "now" to keep SSR deterministic; a real
    // backend would stamp server time here.
    createdAt: "2026-07-08T12:00:00Z",
  };
  db.bookings.push(booking);
  return delay(booking);
}

/**
 * PATCH /api/bookings/:id/status
 * Body: { status: BookingStatus }
 * 200 -> Booking
 * Used on: /booking/[id] (cancel), /dashboard caretaker actions (accept/decline),
 *          mock "Confirm & Pay" step (accepted -> in_progress), completion
 */
export async function updateBookingStatus(
  id: string,
  status: BookingStatus
): Promise<Booking> {
  const booking = db.bookings.find((b) => b.id === id);
  if (!booking) throw new Error(`Booking ${id} not found`);
  booking.status = status;
  return delay({ ...booking });
}
