"use client";

import Link from "next/link";
import type {
  User,
  Booking,
  CaretakerWithUser,
  Order,
  VetAppointment,
} from "@/types";
import { getPetsByOwner } from "@/lib/api/pets";
import { getBookingsByOwner } from "@/lib/api/bookings";
import { getCaretakerById } from "@/lib/api/caretakers";
import { getAppointmentsByOwner } from "@/lib/api/appointments";
import { getMyOrders } from "@/lib/api/orders";
import { useAsync } from "@/lib/hooks/useAsync";
import { PetCard } from "@/components/PetCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { BookingListRow } from "./BookingListRow";
import { AppointmentStatusBadge } from "@/components/vet/AppointmentStatusBadge";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { RecommendedForPet } from "@/components/store/RecommendedForPet";
import { Skeleton } from "@/components/ui/Skeleton";
import { PlusIcon, PawIcon, StethoscopeIcon, TruckIcon } from "@/components/ui/icons";
import { formatCents, formatDate, formatRange } from "@/lib/utils";

const UPCOMING = new Set(["requested", "accepted", "in_progress"]);
const APPOINTMENT_UPCOMING = new Set(["requested", "confirmed", "in_progress"]);
/** Orders still on their way — the ones worth a dashboard slot. */
const ORDER_IN_FLIGHT = new Set([
  "pending_payment",
  "paid",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
]);

export function OwnerDashboard({ user }: { user: User }) {
  const { data: pets, loading: loadingPets } = useAsync(
    () => getPetsByOwner(user.id),
    [user.id]
  );
  const { data, loading: loadingBookings } = useAsync(async () => {
    const bookings = await getBookingsByOwner(user.id);
    const ids = [...new Set(bookings.map((b) => b.caretakerId))];
    const cts = await Promise.all(ids.map((id) => getCaretakerById(id)));
    const map = new Map<string, CaretakerWithUser>();
    cts.forEach((c) => c && map.set(c.id, c));
    return { bookings, map };
  }, [user.id]);

  const { data: appointments } = useAsync(
    () => getAppointmentsByOwner(user.id),
    [user.id]
  );
  const { data: orders } = useAsync(() => getMyOrders(), [user.id]);

  const bookings = data?.bookings ?? [];
  const upcoming = bookings.filter((b) => UPCOMING.has(b.status));
  const past = bookings.filter((b) => !UPCOMING.has(b.status));

  return (
    <div className="space-y-10">
      {/* Pets */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Your pets</h2>
          <Link
            href="/dashboard/pets/new"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-leash hover:text-leash-hover"
          >
            <PlusIcon width={16} height={16} /> Add a pet
          </Link>
        </div>
        {loadingPets ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PetCardSkeleton />
            <PetCardSkeleton />
          </div>
        ) : pets && pets.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pets.map((pet) => (
              <PetCard key={pet.id} pet={pet} href={`/dashboard/pets/${pet.id}`} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<PawIcon width={36} height={36} />}
            title="No pets yet"
            description="Add your first pet so caretakers know exactly how to care for them."
            actionLabel="Add a pet"
            actionHref="/dashboard/pets/new"
          />
        )}
      </section>

      {/* Health and deliveries — the two other things in flight for this pet */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VetSection appointments={(appointments ?? []).filter((a) => APPOINTMENT_UPCOMING.has(a.status))} />
        <OrdersSection orders={(orders ?? []).filter((o) => ORDER_IN_FLIGHT.has(o.status))} />
      </div>

      {/* Store picks for the first pet — the store reading the pet record */}
      {pets && pets.length > 0 && <RecommendedForPet pet={pets[0]} />}

      {/* Upcoming bookings */}
      <BookingSection
        title="Upcoming bookings"
        loading={loadingBookings}
        bookings={upcoming}
        emptyTitle="No upcoming bookings"
        emptyDesc="Find a caretaker and request your first booking — it only takes a minute."
        resolve={(b) => data?.map.get(b.caretakerId)}
      />

      {/* Past bookings */}
      <BookingSection
        title="Past bookings"
        loading={loadingBookings}
        bookings={past}
        emptyTitle="Nothing here yet"
        emptyDesc="Your completed and cancelled bookings will show up here."
        resolve={(b) => data?.map.get(b.caretakerId)}
      />
    </div>
  );
}

function BookingSection({
  title,
  loading,
  bookings,
  emptyTitle,
  emptyDesc,
  resolve,
}: {
  title: string;
  loading: boolean;
  bookings: Booking[];
  emptyTitle: string;
  emptyDesc: string;
  resolve: (b: Booking) => CaretakerWithUser | undefined;
}) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-[76px] w-full rounded-[12px]" />
          <Skeleton className="h-[76px] w-full rounded-[12px]" />
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDesc}
          actionLabel={title.startsWith("Upcoming") ? "Find a caretaker" : undefined}
          actionHref={title.startsWith("Upcoming") ? "/search" : undefined}
        />
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const ct = resolve(b);
            return (
              <BookingListRow
                key={b.id}
                booking={b}
                counterpartName={ct?.user.name ?? "Caretaker"}
                counterpartAvatar={ct?.user.avatarUrl}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function VetSection({ appointments }: { appointments: VetAppointment[] }) {
  return (
    <section className="rounded-2xl border border-mist bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <StethoscopeIcon width={16} height={16} />
          Vet appointments
        </h2>
        <Link
          href="/vets"
          className="text-xs font-medium text-leash hover:text-leash-hover"
        >
          Book a vet
        </Link>
      </div>
      {appointments.length === 0 ? (
        <p className="text-sm text-charcoal/60">
          Nothing booked. Wellness visits are easier to get than emergency ones.
        </p>
      ) : (
        <ul className="space-y-2">
          {appointments.slice(0, 3).map((a) => (
            <li key={a.id}>
              <Link
                href={`/appointments/${a.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2.5 transition-colors hover:border-ink/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{a.reason}</span>
                  <span className="block font-mono text-xs text-charcoal/55">
                    {formatRange(a.startDateTime, a.endDateTime)}
                  </span>
                </span>
                <AppointmentStatusBadge status={a.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrdersSection({ orders }: { orders: Order[] }) {
  return (
    <section className="rounded-2xl border border-mist bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TruckIcon width={16} height={16} />
          On its way
        </h2>
        <Link
          href="/store"
          className="text-xs font-medium text-leash hover:text-leash-hover"
        >
          Shop
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-charcoal/60">
          No deliveries in flight. Food, treats and prescribed diets are in the store.
        </p>
      ) : (
        <ul className="space-y-2">
          {orders.slice(0, 3).map((o) => (
            <li key={o.id}>
              <Link
                href={`/store/orders/${o.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2.5 transition-colors hover:border-ink/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">
                    {o.items.length} item{o.items.length === 1 ? "" : "s"} ·{" "}
                    {formatCents(o.totalCents)}
                  </span>
                  <span className="block font-mono text-xs text-charcoal/55">
                    {o.estimatedDeliveryAt
                      ? `Due ${formatDate(o.estimatedDeliveryAt)}`
                      : `Placed ${formatDate(o.placedAt)}`}
                  </span>
                </span>
                <OrderStatusBadge status={o.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
