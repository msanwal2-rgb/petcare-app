import type {
  AppointmentStatus,
  Booking,
  BookingStatus,
  Pet,
  PublicUser,
  VetAppointment,
} from "@/types";
import type { StatusTone } from "@/components/ui/StatusBadge";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONE,
  BOOKING_STATUS_TONE,
  CONSULT_MODE_LABELS,
  SERVICE_LABELS,
  STATUS_LABELS,
} from "@/lib/utils";

/**
 * One thing on somebody's calendar — a vet visit or a booking — in the shape
 * the dashboards' shared schedule renders. The vet and caretaker dashboards
 * are one layout over two tables, and the owner's calendar holds both kinds;
 * this is the seam that makes that one component rather than three.
 *
 * Built from the API's rows plus the names and photos resolved alongside
 * them. The raw row rides along (`appointment` / `booking`) for the actions
 * each dashboard attaches.
 */
export interface Engagement {
  id: string;
  kind: "appointment" | "booking";
  start: string;
  end: string;
  status: AppointmentStatus | BookingStatus;
  statusLabel: string;
  tone: StatusTone;
  /** "Annual wellness exam" / "Boarding". */
  title: string;
  /** "In clinic" / "Video call" for a visit; the service for a booking. */
  modeLabel: string;
  /** Symptoms or the owner's note. */
  detail: string;
  /** USD, or null when the viewer is not shown it. */
  price: number | null;
  pets: Pick<Pet, "id" | "name" | "photoUrl">[];
  /** The other side: who asked, or who is providing. */
  counterpart: {
    role: string;
    name: string;
    avatarUrl?: string;
    place?: string;
  } | null;
  href: string;
  appointment?: VetAppointment;
  booking?: Booking;
}

/** The statuses still live, per vocabulary — what "upcoming" means. */
export const LIVE_APPOINTMENT = "requested,confirmed,in_progress";
export const LIVE_BOOKING = "requested,accepted,in_progress";

/** Live plus completed — what the calendar shows. Declined and cancelled never happened. */
export const ACTIVE_APPOINTMENT = `${LIVE_APPOINTMENT},completed`;
export const ACTIVE_BOOKING = `${LIVE_BOOKING},completed`;

type PetLite = Pick<Pet, "id" | "name" | "photoUrl">;

export function fromAppointment(
  a: VetAppointment,
  pets: Map<string, PetLite>,
  counterpart: Engagement["counterpart"],
): Engagement {
  const pet = pets.get(a.petId);
  return {
    id: a.id,
    kind: "appointment",
    start: a.startDateTime,
    end: a.endDateTime,
    status: a.status,
    statusLabel: APPOINTMENT_STATUS_LABELS[a.status],
    tone: APPOINTMENT_STATUS_TONE[a.status],
    title: a.reason,
    modeLabel: CONSULT_MODE_LABELS[a.mode],
    detail: a.symptoms.length > 0 ? a.symptoms.join(" · ") : a.notes,
    price: a.fee ?? null,
    pets: pet ? [pet] : [],
    counterpart,
    href: `/appointments/${a.id}`,
    appointment: a,
  };
}

export function fromBooking(
  b: Booking,
  pets: Map<string, PetLite>,
  counterpart: Engagement["counterpart"],
): Engagement {
  return {
    id: b.id,
    kind: "booking",
    start: b.startDateTime,
    end: b.endDateTime,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status],
    tone: BOOKING_STATUS_TONE[b.status],
    title: SERVICE_LABELS[b.serviceType],
    modeLabel: `${b.petIds.length} pet${b.petIds.length === 1 ? "" : "s"}`,
    detail: b.notes,
    price: b.priceTotal,
    pets: b.petIds.map((id) => pets.get(id)).filter((p): p is PetLite => !!p),
    counterpart,
    href: `/booking/${b.id}`,
    booking: b,
  };
}

/** The person as a counterpart block. */
export function personCounterpart(
  role: string,
  user: PublicUser | undefined,
  fallback: string,
): Engagement["counterpart"] {
  return {
    role,
    name: user?.name ?? fallback,
    avatarUrl: user?.avatarUrl,
    place: user ? [user.address.city, user.address.state].filter(Boolean).join(", ") : undefined,
  };
}

/**
 * A window read: one cursor page of engagements. `only` narrows the statuses:
 * "live" is what can still happen, "active" adds what was completed. Each
 * source knows its own vocabulary for both.
 */
export interface WindowRequest {
  from: string;
  to?: string;
  only?: "live" | "active";
  cursor?: string;
  limit: number;
}

export interface EngagementPage {
  items: Engagement[];
  nextCursor: string | null;
}

export type EngagementSource = (req: WindowRequest) => Promise<EngagementPage>;

/** Soonest first; the id breaks ties so the order is stable across reloads. */
export function bySoonest(a: Engagement, b: Engagement): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1;
}

/**
 * Every page of every source for a window, merged soonest first — the month
 * the calendar shows. A month is small; the cap is a backstop, not a limit
 * anyone should reach.
 */
export async function loadWindow(
  sources: EngagementSource[],
  from: string,
  to: string,
): Promise<Engagement[]> {
  const all = await Promise.all(
    sources.map(async (source) => {
      const items: Engagement[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await source({ from, to, only: "active", cursor, limit: 100 });
        items.push(...res.items);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return items;
    }),
  );
  return all.flat().sort(bySoonest);
}
