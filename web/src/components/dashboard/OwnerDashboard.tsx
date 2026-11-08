import { Link } from "react-router";
import { useMemo } from "react";
import type { User, Booking, Order, VetAppointment } from "@/types";
import { getMyStats } from "@/api/dashboard";
import { listMyPets } from "@/api/pets";
import { listMyBookings } from "@/api/bookings";
import { getCaretaker, type CaretakerWithUser } from "@/api/caretakers";
import { listMyAppointments } from "@/api/appointments";
import { listMyOrders } from "@/api/orders";
import { useAsync } from "@/hooks/useAsync";
import { PetCard } from "@/components/PetCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { BookingListRow } from "./BookingListRow";
import { AppointmentStatusBadge } from "@/components/vet/AppointmentStatusBadge";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { RecommendedForPet } from "@/components/store/RecommendedForPet";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  PawIcon,
  StethoscopeIcon,
  TruckIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { startOfTodayIso } from "@/lib/calendar";
import { formatCents, formatDate, formatRange } from "@/lib/utils";
import { ScheduleOverview } from "./schedule/ScheduleOverview";
import { StatCards } from "./schedule/StatCards";
import { ownerBookingSource, ownerVisitSource } from "./schedule/sources";

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

/**
 * The lists below are cursor pages, newest first; the dashboard reads the
 * first page at the API's maximum size and splits it client-side, as the
 * reference did with its unpaginated arrays. A hundred is more history than a
 * dashboard has room to show — the complete record is one click away on each
 * booking, visit and order.
 */
const PAGE = { limit: 100 };

const NOUN = { one: "booking", many: "bookings" };

/**
 * The owner's dashboard. The top matches the vet's and caretaker's (the
 * client's call): three cards, then the upcoming list beside a calendar of
 * bookings and vet visits together. Under that, what the owner had before —
 * pets, visits and deliveries in flight, store picks, bookings.
 */
export function OwnerDashboard({ user }: { user: User }) {
  const { data: pets, loading: loadingPets } = useAsync(
    () => listMyPets(),
    [user.id]
  );

  const stats = useAsync(() => getMyStats(startOfTodayIso()), [user.id]);

  // Built once the pets are in, so every engagement can name its animal.
  const sources = useMemo(() => {
    if (!pets) return null;
    const byId = new Map(pets.map((p) => [p.id, p]));
    return [ownerVisitSource(byId), ownerBookingSource(byId)];
  }, [pets]);
  const { data, loading: loadingBookings } = useAsync(async () => {
    const { items: bookings } = await listMyBookings(PAGE);
    const ids = [...new Set(bookings.map((b) => b.caretakerId))];
    const cts = await Promise.all(ids.map((id) => getCaretaker(id)));
    const map = new Map<string, CaretakerWithUser>();
    cts.forEach((c) => c && map.set(c.profile.id, c));
    return { bookings, map };
  }, [user.id]);

  const { data: appointments } = useAsync(
    async () => (await listMyAppointments(PAGE)).items,
    [user.id]
  );
  const { data: orders } = useAsync(
    async () => (await listMyOrders(PAGE)).items,
    [user.id]
  );

  const bookings = data?.bookings ?? [];
  const upcoming = bookings.filter((b) => UPCOMING.has(b.status));
  const past = bookings.filter((b) => !UPCOMING.has(b.status));

  return (
    <RevealGroup className="space-y-10">
      <RevealItem>
        <StatCards
          loading={stats.loading && !stats.data}
          failed={!!stats.error}
          cards={[
            {
              label: "Total spent",
              value: formatCents(stats.data?.spentCents ?? 0),
              hint: "Store orders, Leash Plus and adoption fees, after refunds",
              icon: <WalletIcon width={18} height={18} />,
            },
            {
              label: "Total requests",
              value: String(stats.data?.requests ?? 0),
              hint: "Bookings and vet visits, less declined and cancelled",
              icon: <CalendarIcon width={18} height={18} />,
            },
            {
              label: "Upcoming",
              value: String(stats.data?.upcoming ?? 0),
              hint: "Requested, confirmed or under way — today or later",
              icon: <ClockIcon width={18} height={18} />,
            },
          ]}
        />
      </RevealItem>

      <RevealItem>
        <h2 className="mb-3 text-lg font-semibold text-ink">Calendar</h2>
        {sources ? (
          <ScheduleOverview
            sources={sources}
            version={0}
            noun={NOUN}
            emptyUpcoming="Nothing coming up. Book a caretaker or a vet and it will show here."
          />
        ) : (
          <Skeleton className="h-80 w-full rounded-2xl" />
        )}
      </RevealItem>

      {/* Pets */}
      <RevealItem>
        <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Your pets</h2>
          <Link
            to="/dashboard/pets/new"
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
      </RevealItem>

      {/* Health and deliveries — the two other things in flight for this pet */}
      <RevealItem className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <VetSection appointments={(appointments ?? []).filter((a) => APPOINTMENT_UPCOMING.has(a.status))} />
        <OrdersSection orders={(orders ?? []).filter((o) => ORDER_IN_FLIGHT.has(o.status))} />
      </RevealItem>

      {/* Store picks for the first pet — the store reading the pet record */}
      {pets && pets.length > 0 && (
        <RevealItem>
          <RecommendedForPet pet={pets[0]} />
        </RevealItem>
      )}

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
    </RevealGroup>
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
    <RevealItem>
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
    </RevealItem>
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
          to="/vets"
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
                to={`/appointments/${a.id}`}
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
          to="/store"
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
                to={`/store/orders/${o.id}`}
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
