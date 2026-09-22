import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { Pet, ServiceType } from "@/types";
import { getCaretaker, type CaretakerWithUser } from "@/api/caretakers";
import { createBooking } from "@/api/bookings";
import { listMyPets } from "@/api/pets";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { SERVICE_LABELS, formatCurrency } from "@/lib/utils";

/** The minimum notice the server enforces for a standard customer. */
const LEAD_TIME_HOURS = 24;

/**
 * Request a booking.
 *
 * ── The total on this page is an estimate ──
 *
 * It is computed from the caretaker's published rate card so the customer knows
 * roughly what they are agreeing to, and it is **not sent**. The server prices
 * the booking from the same rate card when it creates it. If the two ever
 * disagree — a rate changed between load and submit — the server's number is
 * the real one, and it comes back in the response.
 */
export default function BookingNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const caretakerId = params.get("caretakerId") ?? "";

  const [caretaker, setCaretaker] = useState<CaretakerWithUser | null | undefined>(
    undefined,
  );
  const [pets, setPets] = useState<Pet[]>([]);

  /**
   * What the customer picked, if they picked anything. The effective service is
   * derived below — defaulting it here with an effect would set state during
   * render and cascade an extra one for no reason.
   */
  const [chosenService, setChosenService] = useState<ServiceType | "">("");
  const [petIds, setPetIds] = useState<string[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  useEffect(() => {
    getCaretaker(caretakerId).then(setCaretaker).catch(() => setCaretaker(null));
    listMyPets().then(setPets).catch(() => setPets([]));
  }, [caretakerId]);

  if (caretaker === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (caretaker === null) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Caretaker not found</h1>
      </div>
    );
  }

  // The first service they offer, until the customer picks another — so the
  // form is usable without a choice being forced first.
  const serviceType: ServiceType | "" =
    chosenService || caretaker.profile.servicesOffered[0] || "";

  const rate = caretaker.profile.pricing.find((p) => p.serviceType === serviceType);
  const estimate = estimateTotal(rate?.rate, rate?.unit, start, end);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setIssues({});

    try {
      const booking = await createBooking({
        caretakerId,
        petIds,
        serviceType: serviceType as ServiceType,
        startDateTime: new Date(start).toISOString(),
        endDateTime: new Date(end).toISOString(),
        notes,
      });
      navigate(`/booking/${booking.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">
        Book {caretaker.user.name}
      </h1>
      <p className="mt-1 mb-8 text-sm text-charcoal/60">
        They will see this as a request and can accept or decline it.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
          >
            {error}
          </p>
        )}

        <Field label="Service" htmlFor="serviceType" error={issues.serviceType}>
          <Select
            id="serviceType"
            value={serviceType}
            onChange={(e) => setChosenService(e.target.value as ServiceType)}
          >
            {caretaker.profile.servicesOffered.map((s) => (
              <option key={s} value={s}>
                {SERVICE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Pets"
          hint="one booking can cover several"
          error={issues.petIds}
        >
          {pets.length === 0 ? (
            <p className="rounded-xl border border-dashed border-mist p-4 text-sm text-charcoal/65">
              Add a pet first — a booking has to be for somebody.
            </p>
          ) : (
            <ul className="space-y-2">
              {pets.map((pet) => (
                <li key={pet.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-mist px-4 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={petIds.includes(pet.id)}
                      onChange={(e) =>
                        setPetIds((current) =>
                          e.target.checked
                            ? [...current, pet.id]
                            : current.filter((id) => id !== pet.id),
                        )
                      }
                    />
                    <span className="text-ink">{pet.name}</span>
                    <span className="text-charcoal/55">{pet.breed}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Starts"
            hint={`${LEAD_TIME_HOURS}h notice`}
            htmlFor="start"
            error={issues.startDateTime}
          >
            <Input
              id="start"
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </Field>

          <Field label="Ends" htmlFor="end" error={issues.endDateTime}>
            <Input
              id="end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Anything they should know?" htmlFor="notes" error={issues.notes}>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="He pulls a little on the leash when he spots a squirrel."
          />
        </Field>

        {rate && (
          <div className="rounded-xl border border-mist bg-white p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-charcoal/70">
                {formatCurrency(rate.rate)} / {rate.unit}
              </span>
              <span className="text-lg font-semibold text-ink">
                {estimate === null ? "—" : formatCurrency(estimate)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-charcoal/55">
              An estimate. The final price is calculated by the server from this
              same rate card.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button
            type="submit"
            variant="cta"
            disabled={saving || petIds.length === 0 || !start || !end}
          >
            {saving ? "Sending…" : "Request booking"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

/**
 * The same arithmetic the server uses: hours to the nearest, days rounded up,
 * both floored at one unit. Kept in step with `BookingService.PriceBooking`.
 */
function estimateTotal(
  rate: number | undefined,
  unit: string | undefined,
  start: string,
  end: string,
): number | null {
  if (rate === undefined || !start || !end) return null;

  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const units =
    unit === "day"
      ? Math.max(1, Math.ceil(ms / 86_400_000))
      : Math.max(1, Math.round(ms / 3_600_000));

  return rate * units;
}
