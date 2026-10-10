import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { VetAppointment } from "@/types";
import { listMyAppointments } from "@/api/appointments";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONE,
  CONSULT_MODE_LABELS,
  formatCurrency,
  formatDateTime,
} from "@/lib/utils";

/**
 * The owner's vet appointments.
 *
 * Paginated with "Show more" rather than page numbers, like every other list in
 * this app: the API is cursor-based and there is no total to count against.
 *
 * Sorted by when the visit **is**, not when it was booked — which is what
 * somebody opening this page is asking about. (A caretaker's booking queue
 * sorts the other way, because that is a queue of requests to answer.)
 */
export default function AppointmentsPage() {
  const [items, setItems] = useState<VetAppointment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    listMyAppointments({ limit: 10 })
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
      const page = await listMyAppointments({ cursor, limit: 10 });
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
          <h1 className="text-2xl font-semibold text-ink">Your vet visits</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            Requests, confirmed visits, and everything already seen. Notes and
            prescriptions live in each pet's health record.
          </p>
        </div>
        <ButtonLink to="/vets" variant="cta">
          Find a vet
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
          No appointments yet. Book one and the visit summary will appear in your
          pet's record afterwards.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 space-y-3">
            {items.map((appointment) => (
              <li key={appointment.id}>
                <Link
                  to={`/appointment/${appointment.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-mist bg-white p-4 transition-colors hover:border-ink"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {CONSULT_MODE_LABELS[appointment.mode]}
                      <span className="text-charcoal/55">
                        {" · "}
                        {appointment.reason}
                      </span>
                    </p>
                    <p className="mt-0.5 text-sm text-charcoal/60">
                      {formatDateTime(appointment.startDateTime)}
                      {" · "}
                      {formatCurrency(appointment.fee)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={APPOINTMENT_STATUS_TONE[appointment.status]}
                    label={APPOINTMENT_STATUS_LABELS[appointment.status]}
                  />
                </Link>
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
