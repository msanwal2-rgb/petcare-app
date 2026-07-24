"use client";

import Image from "next/image";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { useState } from "react";
import type { BookingStatus } from "@/types";
import { getBookingById, updateBookingStatus } from "@/lib/api/bookings";
import { getCaretakerById } from "@/lib/api/caretakers";
import { getUserById } from "@/lib/api/users";
import { getPetsByIds } from "@/lib/api/pets";
import { getReviewsForBooking } from "@/lib/api/reviews";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { BookingStatusBadge } from "@/components/BookingStatusBadge";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { PetCard } from "@/components/PetCard";
import { ReviewCard } from "@/components/ReviewCard";
import { EmptyState } from "@/components/EmptyState";
import { LeaveReview } from "@/components/booking/LeaveReview";
import { MessageThread } from "@/components/booking/MessageThread";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
import {
  SERVICE_LABELS,
  STATUS_LABELS,
  formatRange,
  formatCurrency,
  cn,
} from "@/lib/utils";

const TIMELINE: BookingStatus[] = [
  "requested",
  "accepted",
  "in_progress",
  "completed",
];

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser } = useSession();
  const [busy, setBusy] = useState(false);

  const { data: booking, loading, reload } = useAsync(
    () => getBookingById(id),
    [id]
  );
  const { data: caretaker } = useAsync(
    () => (booking ? getCaretakerById(booking.caretakerId) : Promise.resolve(null)),
    [booking?.caretakerId]
  );
  const { data: owner } = useAsync(
    () => (booking ? getUserById(booking.ownerId) : Promise.resolve(null)),
    [booking?.ownerId]
  );
  const { data: pets } = useAsync(
    () => (booking ? getPetsByIds(booking.petIds) : Promise.resolve([])),
    [booking?.petIds]
  );
  const { data: reviews, reload: reloadReviews } = useAsync(
    () => (booking ? getReviewsForBooking(booking.id) : Promise.resolve([])),
    [booking?.id]
  );

  if (loading || booking === null) {
    return !loading && booking === null ? (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Booking not found"
          description="This booking may have been removed. Check your dashboard for current bookings."
          actionLabel="Go to dashboard"
          actionHref="/dashboard"
        />
      </div>
    ) : (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        <Skeleton className="mt-4 h-56 w-full rounded-2xl" />
      </div>
    );
  }

  const isOwner = currentUser?.id === booking.ownerId;
  const isCaretaker =
    !!caretaker && !!currentUser && caretaker.userId === currentUser.id;

  async function setStatus(status: BookingStatus, message: string) {
    setBusy(true);
    try {
      await updateBookingStatus(booking!.id, status);
      toast.success(message);
      reload();
    } catch {
      toast.error("Couldn’t update the booking. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const terminal =
    booking.status === "declined" || booking.status === "cancelled";
  const timelineActive = TIMELINE.indexOf(booking.status);
  const alreadyReviewed =
    !!reviews && !!currentUser && reviews.some((r) => r.fromUserId === currentUser.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-1 flex items-center gap-2 text-sm text-charcoal/55">
        <span className="font-mono">#{booking.id}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">
          {SERVICE_LABELS[booking.serviceType]} booking
        </h1>
        <BookingStatusBadge status={booking.status} />
      </div>

      {/* Status timeline (non-terminal) */}
      {!terminal ? (
        <Reveal className="mt-6 rounded-2xl border border-mist bg-white p-5">
          <ol className="flex items-center">
            {TIMELINE.map((s, i) => {
              const done = i <= timelineActive;
              const isLast = i === TIMELINE.length - 1;
              return (
                <li key={s} className={cn("flex items-center", !isLast && "flex-1")}>
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-mono",
                        done
                          ? "border-ink bg-ink text-white"
                          : "border-mist bg-white text-charcoal/40"
                      )}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={cn(
                        "mt-1.5 text-[11px]",
                        done ? "text-ink" : "text-charcoal/40"
                      )}
                    >
                      {STATUS_LABELS[s]}
                    </span>
                  </div>
                  {!isLast && (
                    <span
                      className={cn(
                        "mx-1 mb-5 h-0.5 flex-1 rounded",
                        i < timelineActive ? "bg-ink" : "bg-mist"
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </Reveal>
      ) : (
        <div className="mt-6 rounded-2xl border border-mist bg-white p-5 text-sm text-charcoal/70">
          This booking was {STATUS_LABELS[booking.status].toLowerCase()}.{" "}
          {isOwner && (
            <ButtonLink
              href={`/booking/new?caretakerId=${booking.caretakerId}`}
              variant="ghost"
              size="sm"
            >
              Rebook
            </ButtonLink>
          )}
        </div>
      )}

      {/* Parties */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {caretaker && (
          <PartyCard
            label="Caretaker"
            name={caretaker.user.name}
            avatarUrl={caretaker.user.avatarUrl}
            sub={`${caretaker.user.address.city}, ${caretaker.user.address.state}`}
            href={`/caretaker/${caretaker.id}`}
          />
        )}
        {owner && (
          <PartyCard
            label="Pet owner"
            name={owner.name}
            avatarUrl={owner.avatarUrl}
            sub={`${owner.address.city}, ${owner.address.state}`}
          />
        )}
      </div>

      {/* Details */}
      <div className="mt-4 rounded-2xl border border-mist bg-white p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Detail label="Service">
            <ServiceTypeChip service={booking.serviceType} size="sm" />
          </Detail>
          <Detail label="Price">
            <span className="font-mono font-semibold text-ink">
              {formatCurrency(booking.priceTotal)}
            </span>
          </Detail>
          <Detail label="When" full>
            <span className="text-sm text-charcoal">
              {formatRange(booking.startDateTime, booking.endDateTime)}
            </span>
          </Detail>
          {booking.notes && (
            <Detail label="Notes" full>
              <span className="text-sm text-charcoal/80">{booking.notes}</span>
            </Detail>
          )}
        </div>

        <div className="mt-4 border-t border-mist pt-4">
          <p className="mb-2 text-sm font-medium text-ink">
            Pet{pets && pets.length > 1 ? "s" : ""}
          </p>
          <div className="space-y-2">
            {pets === null ? (
              <Skeleton className="h-24 w-full rounded-[12px]" />
            ) : (
              pets.map((pet) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  href={isOwner ? `/dashboard/pets/${pet.id}` : undefined}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {(isOwner || isCaretaker) && (
        <div className="mt-4 flex flex-wrap gap-3 rounded-2xl border border-mist bg-white p-5">
          {isCaretaker && booking.status === "requested" && (
            <>
              <Button
                variant="cta"
                onClick={() => setStatus("accepted", "Booking accepted.")}
                disabled={busy}
              >
                Accept request
              </Button>
              <Button
                variant="outline"
                onClick={() => setStatus("declined", "Booking declined.")}
                disabled={busy}
              >
                Decline
              </Button>
            </>
          )}
          {isCaretaker && booking.status === "accepted" && (
            <Button
              variant="cta"
              onClick={() => setStatus("in_progress", "Service started.")}
              disabled={busy}
            >
              Start service
            </Button>
          )}
          {isCaretaker && booking.status === "in_progress" && (
            <Button
              variant="cta"
              onClick={() => setStatus("completed", "Marked complete — nice work!")}
              disabled={busy}
            >
              Mark complete
            </Button>
          )}
          {isOwner &&
            (booking.status === "requested" || booking.status === "accepted") && (
              <Button
                variant="outline"
                onClick={() => setStatus("cancelled", "Booking cancelled.")}
                disabled={busy}
              >
                Cancel booking
              </Button>
            )}
          {!isCaretaker &&
            isOwner &&
            !["requested", "accepted"].includes(booking.status) && (
              <p className="text-sm text-charcoal/55">
                No actions available for this booking right now.
              </p>
            )}
        </div>
      )}

      {/* Messages (participants only) */}
      {(isOwner || isCaretaker) && currentUser && (owner || caretaker) && (
        <MessageThread
          bookingId={booking.id}
          currentUserId={currentUser.id}
          people={{
            ...(owner
              ? { [owner.id]: { name: owner.name, avatarUrl: owner.avatarUrl } }
              : {}),
            ...(caretaker
              ? {
                  [caretaker.user.id]: {
                    name: caretaker.user.name,
                    avatarUrl: caretaker.user.avatarUrl,
                  },
                }
              : {}),
          }}
        />
      )}

      {/* Reviews */}
      {booking.status === "completed" && (
        <div className="mt-6">
          <h2 className="text-lg font-semibold text-ink">Reviews</h2>
          <div className="mt-3 space-y-4">
            {reviews && reviews.length > 0 ? (
              reviews.map((r) => <ReviewCard key={r.id} review={r} />)
            ) : (
              <p className="text-sm text-charcoal/55">No reviews yet.</p>
            )}
            {(isOwner || isCaretaker) && !alreadyReviewed && caretaker && owner && (
              <LeaveReview
                bookingId={booking.id}
                fromUserId={currentUser!.id}
                toUserId={isOwner ? caretaker.userId : booking.ownerId}
                toName={isOwner ? caretaker.user.name : owner.name}
                onDone={reloadReviews}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PartyCard({
  label,
  name,
  avatarUrl,
  sub,
  href,
}: {
  label: string;
  name: string;
  avatarUrl: string;
  sub: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="relative h-11 w-11 overflow-hidden rounded-full">
        <Image
          src={avatarUrl}
          alt=""
          fill
          sizes="44px"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          className="object-cover"
        />
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/50">
          {label}
        </p>
        <p className="truncate font-semibold text-ink">{name}</p>
        <p className="truncate text-xs text-charcoal/60">{sub}</p>
      </div>
    </>
  );
  const cls =
    "flex items-center gap-3 rounded-2xl border border-mist bg-white p-4";
  return href ? (
    <a href={href} className={cn(cls, "transition-colors hover:border-ink/30")}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function Detail({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn(full && "sm:col-span-2")}>
      <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/50">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
