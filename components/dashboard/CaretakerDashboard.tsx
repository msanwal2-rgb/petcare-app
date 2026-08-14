"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import type { User, Booking, BookingStatus } from "@/types";
import { getCaretakerByUserId } from "@/lib/api/caretakers";
import {
  getBookingsByCaretaker,
  updateBookingStatus,
} from "@/lib/api/bookings";
import { getUsersByIds } from "@/lib/api/users";
import { useAsync } from "@/lib/hooks/useAsync";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { BookingListRow } from "./BookingListRow";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { RevealGroup, RevealItem } from "@/components/ui/Reveal";
import { Skeleton } from "@/components/ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { formatRange, formatCurrency } from "@/lib/utils";

export function CaretakerDashboard({ user }: { user: User }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: profile, loading: loadingProfile } = useAsync(
    () => getCaretakerByUserId(user.id),
    [user.id]
  );
  const { data, loading, reload } = useAsync(async () => {
    if (!profile) return null;
    const bookings = await getBookingsByCaretaker(profile.id);
    const owners = await getUsersByIds(bookings.map((b) => b.ownerId));
    const map = new Map(owners.map((o) => [o.id, o]));
    return { bookings, map };
  }, [profile?.id]);

  if (loadingProfile) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  if (!profile) {
    return (
      <EmptyState
        title="Set up your caretaker profile"
        description="Add your services, pricing, and availability so owners can find and book you."
        actionLabel="Create caretaker profile"
        actionHref="/dashboard/caretaker-profile"
      />
    );
  }

  const bookings = data?.bookings ?? [];
  const requests = bookings.filter((b) => b.status === "requested");
  const active = bookings.filter((b) =>
    ["accepted", "in_progress"].includes(b.status)
  );
  const history = bookings.filter((b) =>
    ["completed", "declined", "cancelled"].includes(b.status)
  );
  const ownerName = (b: Booking) => data?.map.get(b.ownerId)?.name ?? "Owner";
  const ownerAvatar = (b: Booking) => data?.map.get(b.ownerId)?.avatarUrl;

  async function act(id: string, status: BookingStatus, msg: string) {
    setBusyId(id);
    try {
      await updateBookingStatus(id, status);
      toast.success(msg);
      reload();
    } catch {
      toast.error("Couldn’t update. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <RevealGroup className="space-y-10">
      {/* Incoming requests */}
      <RevealItem>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-ink">
          Incoming requests
          {requests.length > 0 && (
            <span className="rounded-full bg-leash px-2 py-0.5 font-mono text-xs text-white">
              {requests.length}
            </span>
          )}
        </h2>
        {loading ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : requests.length === 0 ? (
          <EmptyState
            title="No pending requests"
            description="When an owner requests a booking, it’ll appear here for you to accept or decline."
          />
        ) : (
          <div className="space-y-3">
            {requests.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl border border-marigold/40 bg-marigold/5 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {ownerAvatar(b) && (
                      <div className="relative h-11 w-11 overflow-hidden rounded-full">
                        <Image
                          src={ownerAvatar(b)!}
                          alt=""
                          fill
                          sizes="44px"
                          placeholder="blur"
                          blurDataURL={BLUR_DATA_URL}
                          className="object-cover"
                        />
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-ink">{ownerName(b)}</p>
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-charcoal/65">
                        <ServiceTypeChip service={b.serviceType} size="sm" />
                        {b.petIds.length} pet{b.petIds.length > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-sm font-medium text-ink">
                    {formatCurrency(b.priceTotal)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-charcoal/60">
                  {formatRange(b.startDateTime, b.endDateTime)}
                </p>
                {b.notes && (
                  <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-sm text-charcoal/80">
                    “{b.notes}”
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="cta"
                    size="sm"
                    onClick={() => act(b.id, "accepted", "Request accepted.")}
                    disabled={busyId === b.id}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => act(b.id, "declined", "Request declined.")}
                    disabled={busyId === b.id}
                  >
                    Decline
                  </Button>
                  <Link
                    href={`/booking/${b.id}`}
                    className="ml-1 text-sm text-charcoal/60 hover:text-ink"
                  >
                    View details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </RevealItem>

      {/* Active */}
      <RevealItem>
        <h2 className="mb-4 text-lg font-semibold text-ink">Active bookings</h2>
        {loading ? (
          <Skeleton className="h-[76px] w-full rounded-[12px]" />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active bookings"
            description="Accepted and in-progress bookings will appear here."
          />
        ) : (
          <div className="space-y-3">
            {active.map((b) => (
              <BookingListRow
                key={b.id}
                booking={b}
                counterpartName={ownerName(b)}
                counterpartAvatar={ownerAvatar(b)}
              />
            ))}
          </div>
        )}
      </RevealItem>

      {/* Availability + profile */}
      <RevealItem>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Your availability</h2>
          <ButtonLink
            href="/dashboard/caretaker-profile"
            variant="outline"
            size="sm"
          >
            Edit profile
          </ButtonLink>
        </div>
        <AvailabilityCalendar availability={profile.availability} />
      </RevealItem>

      {/* History */}
      {history.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-ink">History</h2>
          <div className="space-y-3">
            {history.map((b) => (
              <BookingListRow
                key={b.id}
                booking={b}
                counterpartName={ownerName(b)}
                counterpartAvatar={ownerAvatar(b)}
              />
            ))}
          </div>
        </section>
      )}
    </RevealGroup>
  );
}
