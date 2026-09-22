import { useEffect, useState } from "react";
import type { Booking } from "@/types";
import { listMyBookings } from "@/api/bookings";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  BOOKING_STATUS_TONE,
  SERVICE_LABELS,
  STATUS_LABELS,
  formatCurrency,
  formatRange,
} from "@/lib/utils";

/**
 * The owner's bookings.
 *
 * Paginated with "Show more" rather than page numbers, for the same reason as
 * search: the API is cursor-based and there is no total to count against. Here
 * it also happens to be the right interaction — a history is scrolled, not
 * navigated.
 */
export default function BookingsPage() {
  const [items, setItems] = useState<Booking[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    listMyBookings({ limit: 10 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => setItems([]));
  }, []);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listMyBookings({ cursor, limit: 10 });
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Your bookings</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            Requests, confirmed visits and everything already done.
          </p>
        </div>
        <ButtonLink to="/search" variant="cta">
          Find a caretaker
        </ButtonLink>
      </div>

      {items === null && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      )}

      {items?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center text-sm text-charcoal/70">
          No bookings yet. Find someone to look after your pet.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 space-y-3">
            {items.map((booking) => (
              <li key={booking.id}>
                <ButtonLink
                  to={`/booking/${booking.id}`}
                  variant="outline"
                  className="flex w-full items-center justify-between gap-3 !rounded-2xl !px-5 !py-4"
                >
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-medium text-ink">
                      {SERVICE_LABELS[booking.serviceType]} ·{" "}
                      {formatCurrency(booking.priceTotal)}
                    </span>
                    <span className="block truncate text-xs text-charcoal/55">
                      {formatRange(booking.startDateTime, booking.endDateTime)}
                    </span>
                  </span>
                  <StatusBadge
                    tone={BOOKING_STATUS_TONE[booking.status]}
                    label={STATUS_LABELS[booking.status]}
                  />
                </ButtonLink>
              </li>
            ))}
          </ul>

          {cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
