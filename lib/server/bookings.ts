/**
 * Bookings domain — server logic. Bookings are the central object: requests,
 * status changes, and cancellations all live here.
 *
 * Status lifecycle (API_CONTRACTS.md):
 *   requested → accepted → in_progress → completed
 * with `declined` (caretaker) and `cancelled` (either party) as terminal
 * branches. Transitions are enforced here; the frontend only ever issues valid
 * ones, so this simply rejects malformed/duplicate updates.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toBooking } from "./serialize";
import { genId, nowIso } from "./ids";
import { refreshResponseRate } from "./reputation";
import { notify } from "./notifications";
import type { BookingStatus, NotificationKind } from "@/types";
import type { CreateBookingBody } from "@/lib/validation/schemas";

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  requested: ["accepted", "declined", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

/** What the owner hears when a caretaker answers their request. */
const BOOKING_NOTICES: Partial<
  Record<BookingStatus, { kind: NotificationKind; title: string; body: string }>
> = {
  accepted: {
    kind: "booking_accepted",
    title: "Your booking was accepted",
    body: "Your caretaker has confirmed. You can message them from the booking.",
  },
  declined: {
    kind: "booking_declined",
    title: "Your booking request was declined",
    body: "They couldn't take this one — plenty of other caretakers are free.",
  },
};

export type StatusUpdateResult =
  | { ok: true; booking: ReturnType<typeof toBooking> }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "invalid_transition"; from: BookingStatus; to: BookingStatus };

export async function getBookingsByOwner(ownerId: string, db: PrismaClient = defaultPrisma) {
  const rows = await db.booking.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toBooking);
}

export async function getBookingsByCaretaker(
  caretakerId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.booking.findMany({
    where: { caretakerId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toBooking);
}

export async function getBookingById(id: string, db: PrismaClient = defaultPrisma) {
  const b = await db.booking.findUnique({ where: { id } });
  return b ? toBooking(b) : null;
}

export async function createBooking(input: CreateBookingBody, db: PrismaClient = defaultPrisma) {
  const b = await db.booking.create({
    data: {
      ...input,
      id: genId("b"),
      status: "requested",
      createdAt: nowIso(),
    },
  });
  // A new request is one more thing left unanswered until they reply.
  await refreshResponseRate("caretaker", b.caretakerId, db);
  return toBooking(b);
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  db: PrismaClient = defaultPrisma
): Promise<StatusUpdateResult> {
  const existing = await db.booking.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const from = existing.status as BookingStatus;
  if (from !== status && !TRANSITIONS[from].includes(status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }

  const b = await db.booking.update({ where: { id }, data: { status } });
  await refreshResponseRate("caretaker", b.caretakerId, db);

  const told = BOOKING_NOTICES[status];
  if (told) await notify(b.ownerId, { ...told, href: `/booking/${b.id}` }, db);

  return { ok: true, booking: toBooking(b) };
}
