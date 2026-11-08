import type { Pet, PublicUser } from "@/types";
import { listMyAppointments, listVetAppointments } from "@/api/appointments";
import { listCaretakerBookings, listMyBookings } from "@/api/bookings";
import { getCaretaker, type CaretakerWithUser } from "@/api/caretakers";
import { getPetsByIds } from "@/api/pets";
import { getUsersByIds } from "@/api/users";
import { getVet, type VetWithUser } from "@/api/vets";
import {
  LIVE_APPOINTMENT,
  LIVE_BOOKING,
  ACTIVE_APPOINTMENT,
  ACTIVE_BOOKING,
  fromAppointment,
  fromBooking,
  personCounterpart,
  type EngagementSource,
  type WindowRequest,
} from "./engagement";

/**
 * Where each dashboard's engagements come from, with the names and photos
 * resolved alongside. Each source keeps its own small cache, so paging through
 * months does not ask for the same owner twice. Build one per dashboard with
 * `useMemo`.
 */

type PetLite = Pick<Pet, "id" | "name" | "photoUrl">;

/** Resolve ids through a batch fetcher, remembering what came back. */
function cached<T>(fetch: (ids: string[]) => Promise<T[]>, idOf: (t: T) => string) {
  const known = new Map<string, T>();
  return async (ids: string[]): Promise<Map<string, T>> => {
    const missing = [...new Set(ids)].filter((id) => !known.has(id));
    if (missing.length > 0) {
      for (const t of await fetch(missing)) known.set(idOf(t), t);
    }
    return known;
  };
}

/** One-by-one fetches, for the two profile reads that have no batch form. */
function cachedEach<T>(fetchOne: (id: string) => Promise<T | null>) {
  const known = new Map<string, T | null>();
  return async (ids: string[]): Promise<Map<string, T | null>> => {
    const missing = [...new Set(ids)].filter((id) => !known.has(id));
    const fetched = await Promise.all(missing.map((id) => fetchOne(id).catch(() => null)));
    missing.forEach((id, i) => known.set(id, fetched[i]));
    return known;
  };
}

const petsCache = () => cached<Pet>(getPetsByIds, (p) => p.id);
const usersCache = () => cached<PublicUser>(getUsersByIds, (u) => u.id);

const appointmentStatuses = (only: WindowRequest["only"]) =>
  only === "live" ? LIVE_APPOINTMENT : only === "active" ? ACTIVE_APPOINTMENT : undefined;
const bookingStatuses = (only: WindowRequest["only"]) =>
  only === "live" ? LIVE_BOOKING : only === "active" ? ACTIVE_BOOKING : undefined;

/** A clinic's visits, with each patient and the owner who booked. */
export function vetSource(vetId: string): EngagementSource {
  const pets = petsCache();
  const users = usersCache();
  return async ({ only, ...req }) => {
    const page = await listVetAppointments(vetId, {
      ...req,
      status: appointmentStatuses(only),
    });
    const [petMap, userMap] = await Promise.all([
      pets(page.items.map((a) => a.petId)),
      users(page.items.map((a) => a.ownerId)),
    ]);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((a) =>
        fromAppointment(a, petMap, personCounterpart("Requested by", userMap.get(a.ownerId), "Owner")),
      ),
    };
  };
}

/** A caretaker's bookings, with each pet and the owner who booked. */
export function caretakerSource(caretakerId: string): EngagementSource {
  const pets = petsCache();
  const users = usersCache();
  return async ({ only, ...req }) => {
    const page = await listCaretakerBookings(caretakerId, {
      ...req,
      status: bookingStatuses(only),
    });
    const [petMap, userMap] = await Promise.all([
      pets(page.items.flatMap((b) => b.petIds)),
      users(page.items.map((b) => b.ownerId)),
    ]);
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((b) =>
        fromBooking(b, petMap, personCounterpart("Requested by", userMap.get(b.ownerId), "Owner")),
      ),
    };
  };
}

/** An owner's vet visits, with the clinic on the other side. */
export function ownerVisitSource(pets: Map<string, PetLite>): EngagementSource {
  const vets = cachedEach<VetWithUser>(getVet);
  return async ({ only, ...req }) => {
    const page = await listMyAppointments({ ...req, status: appointmentStatuses(only) });
    const vetMap = await vets(page.items.map((a) => a.vetId));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((a) => {
        const vet = vetMap.get(a.vetId);
        return fromAppointment(a, pets, {
          role: "Vet",
          name: vet ? `${vet.user.name} · ${vet.profile.clinicName}` : "Your vet",
          avatarUrl: vet?.user.avatarUrl,
          place: vet ? `${vet.profile.clinic.city}, ${vet.profile.clinic.state}` : undefined,
        });
      }),
    };
  };
}

/** An owner's bookings, with the caretaker on the other side. */
export function ownerBookingSource(pets: Map<string, PetLite>): EngagementSource {
  const carers = cachedEach<CaretakerWithUser>(getCaretaker);
  return async ({ only, ...req }) => {
    const page = await listMyBookings({ ...req, status: bookingStatuses(only) });
    const carerMap = await carers(page.items.map((b) => b.caretakerId));
    return {
      nextCursor: page.nextCursor,
      items: page.items.map((b) =>
        fromBooking(b, pets, personCounterpart("Caretaker", carerMap.get(b.caretakerId)?.user, "Caretaker")),
      ),
    };
  };
}
