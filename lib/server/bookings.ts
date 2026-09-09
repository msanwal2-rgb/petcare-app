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
import type { BookingStatus, NotificationKind, PricingUnit } from "@/types";
import { durationDays, durationHours } from "@/lib/utils";
import type { CreateBookingBody } from "@/lib/validation/schemas";

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  requested: ["accepted", "declined", "cancelled"],
  accepted: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  declined: [],
  cancelled: [],
};

export type BookingActor = "owner" | "caretaker";

/**
 * Which party may drive each transition.
 *
 * Vet appointments have enforced this since they were written; bookings only
 * checked that a transition was *legal*, not who was making it, so an owner
 * could accept their own request and then mark it completed. That is not a
 * hypothetical: `completed` is what unlocks the review form, and every status
 * change feeds `refreshResponseRate`, so the owner of a booking could
 * manufacture a caretaker's response rate and then review them for it.
 *
 * `accepted`/`declined` belong to the caretaker — answering a request is the
 * whole of what a caretaker does. `in_progress` and `completed` are theirs too:
 * they are the one who knows whether the dog was actually walked. Either side
 * may cancel.
 */
const ACTOR_ALLOWED: Record<BookingStatus, BookingActor[]> = {
  requested: [],
  accepted: ["caretaker"],
  declined: ["caretaker"],
  in_progress: ["caretaker"],
  completed: ["caretaker"],
  cancelled: ["owner", "caretaker"],
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
  | { ok: false; code: "invalid_transition"; from: BookingStatus; to: BookingStatus }
  | { ok: false; code: "wrong_actor"; actor: BookingActor; to: BookingStatus };

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

export type CreateBookingResult =
  | { ok: true; booking: ReturnType<typeof toBooking> }
  | { ok: false; code: "caretaker_not_found" }
  | { ok: false; code: "service_not_offered" }
  | { ok: false; code: "bad_dates" };

/**
 * Price a booking from the caretaker's own rate card.
 *
 * The arithmetic is `durationHours`/`durationDays` from lib/utils — the same
 * pure functions the booking form uses to show an estimate — so the number the
 * customer was quoted and the number we store come from one definition rather
 * than two that agree until someone edits one of them.
 */
export function priceBooking(
  rate: number,
  unit: PricingUnit,
  startDateTime: string,
  endDateTime: string
): number {
  const units =
    unit === "day"
      ? durationDays(startDateTime, endDateTime)
      : durationHours(startDateTime, endDateTime);
  // Two decimals: this domain is Float USD, and an unrounded product of a rate
  // and a count is how $210.00000000000003 reaches a receipt.
  return Math.round(rate * units * 100) / 100;
}

export async function createBooking(
  input: CreateBookingBody,
  db: PrismaClient = defaultPrisma
): Promise<CreateBookingResult> {
  const start = Date.parse(input.startDateTime);
  const end = Date.parse(input.endDateTime);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return { ok: false, code: "bad_dates" };
  }

  const caretaker = await db.caretakerProfile.findUnique({
    where: { id: input.caretakerId },
    include: { pricing: true },
  });
  if (!caretaker) return { ok: false, code: "caretaker_not_found" };

  const entry = caretaker.pricing.find((p) => p.serviceType === input.serviceType);
  if (!entry || !caretaker.servicesOffered.includes(input.serviceType)) {
    return { ok: false, code: "service_not_offered" };
  }

  const b = await db.booking.create({
    data: {
      ...input,
      priceTotal: priceBooking(
        entry.rate,
        entry.unit as PricingUnit,
        input.startDateTime,
        input.endDateTime
      ),
      id: genId("b"),
      status: "requested",
      createdAt: nowIso(),
    },
  });
  // A new request is one more thing left unanswered until they reply.
  await refreshResponseRate("caretaker", b.caretakerId, db);
  return { ok: true, booking: toBooking(b) };
}

export async function updateBookingStatus(
  id: string,
  status: BookingStatus,
  db: PrismaClient = defaultPrisma,
  /**
   * Who is asking. Optional so the seeder and the fulfilment-style internal
   * callers can drive the machine directly; every route handler passes it,
   * because on that path there is always a person behind the request.
   */
  actor?: BookingActor
): Promise<StatusUpdateResult> {
  const existing = await db.booking.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const from = existing.status as BookingStatus;
  if (from !== status && !TRANSITIONS[from].includes(status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }

  if (actor && from !== status && !ACTOR_ALLOWED[status].includes(actor)) {
    return { ok: false, code: "wrong_actor", actor, to: status };
  }

  const b = await db.booking.update({ where: { id }, data: { status } });
  await refreshResponseRate("caretaker", b.caretakerId, db);

  const told = BOOKING_NOTICES[status];
  if (told) await notify(b.ownerId, { ...told, href: `/booking/${b.id}` }, db);

  return { ok: true, booking: toBooking(b) };
}
