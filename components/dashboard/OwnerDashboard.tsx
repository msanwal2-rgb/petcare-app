"use client";

import Link from "next/link";
import type { User, Booking, CaretakerWithUser } from "@/types";
import { getPetsByOwner } from "@/lib/api/pets";
import { getBookingsByOwner } from "@/lib/api/bookings";
import { getCaretakerById } from "@/lib/api/caretakers";
import { useAsync } from "@/lib/hooks/useAsync";
import { PetCard } from "@/components/PetCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { BookingListRow } from "./BookingListRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { PlusIcon, PawIcon } from "@/components/ui/icons";

const UPCOMING = new Set(["requested", "accepted", "in_progress"]);

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
