import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getCaretaker } from "@/api/caretakers";
import { listMyPets } from "@/api/pets";
import { createBooking } from "@/api/bookings";
import { bookCaretakerAsGuest } from "@/api/guest";
import { ApiError } from "@/api/_client";
import { GuestDetailsForm } from "@/components/guest/GuestDetailsForm";
import {
  EMPTY_GUEST,
  guestProblems,
  issueErrors,
  toGuestContact,
  toGuestPet,
  type GuestErrors,
} from "@/components/guest/guestDetails";
import type { GuestRequestedState } from "@/pages/GuestRequestedPage";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { useBookingDraft } from "@/store/booking-draft";
import type { ServiceType } from "@/types";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { PetCard } from "@/components/PetCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { AuthRequired } from "@/components/AuthRequired";
import { Avatar } from "@/components/Avatar";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { stayProblem, utcOffsetMinutesAt } from "@/lib/availability";
import {
  SERVICE_LABELS,
  formatCurrency,
  formatRange,
  durationHours,
  durationDays,
  cn,
} from "@/lib/utils";
import { PawIcon } from "@/components/ui/icons";

const STEPS = ["Details", "Review", "Confirm"];

/**
 * Request a booking — the reference's three-step flow, unchanged in shape.
 *
 * The total is an estimate from the published rate card and is **not sent**:
 * the request has no price field, and the server prices the booking from the
 * same card (hours to the nearest, days rounded up, floored at one unit). The
 * owner is not sent either — it is the session. When the server refuses, its
 * reason is shown: most often the 24-hour notice a booking needs.
 *
 * The caretaker's published calendar sits above the dates (STATUS §3-G): the
 * server refuses a drop-off or pick-up outside their open hours, so the form
 * shows the hours, fills them in from a picked day, and says so before
 * sending. The browser's offset goes with the request so the server reads
 * those hours in the same zone.
 *
 * **As a guest** (`guest=1`, from the login page; STATUS §3-G) the pets step is
 * "Your details & your pet" instead, and the request goes to
 * `POST /guest/bookings`. The server writes the guest, a new pet and the
 * booking together; there is no booking page for someone with no session, so
 * the guest lands on /booking/requested.
 */
export function BookingNewClient() {
  const [params] = useSearchParams();
  const caretakerId = params.get("caretakerId") ?? "";
  const navigate = useNavigate();
  const { currentUser, hasHydrated } = useSession();
  const draft = useBookingDraft();
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const guestMode = !currentUser && params.get("guest") === "1";
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [guestServerErrors, setGuestServerErrors] = useState<GuestErrors>({});
  const [accountExists, setAccountExists] = useState(false);

  const { data: caretaker, loading: loadingCaretaker } = useAsync(
    () => (caretakerId ? getCaretaker(caretakerId) : Promise.resolve(null)),
    [caretakerId]
  );
  const { data: pets, loading: loadingPets } = useAsync(
    () => (currentUser ? listMyPets() : Promise.resolve([])),
    [currentUser?.id]
  );

  // Initialize the draft for this caretaker once loaded.
  useEffect(() => {
    if (caretaker && draft.caretakerId !== caretaker.profile.id) {
      draft.reset(caretaker.profile.id);
      draft.set({ serviceType: caretaker.profile.servicesOffered[0] ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretaker]);

  const pricing = useMemo(
    () =>
      caretaker?.profile.pricing.find((p) => p.serviceType === draft.serviceType) ?? null,
    [caretaker, draft.serviceType]
  );

  const units = useMemo(() => {
    if (!pricing || !draft.startDateTime || !draft.endDateTime) return 0;
    return pricing.unit === "day"
      ? durationDays(draft.startDateTime, draft.endDateTime)
      : durationHours(draft.startDateTime, draft.endDateTime);
  }, [pricing, draft.startDateTime, draft.endDateTime]);

  const total = pricing ? pricing.rate * units : 0;

  const stepIndex = STEPS.indexOf(
    draft.step === "details" ? "Details" : draft.step === "review" ? "Review" : "Confirm"
  );

  if (!hasHydrated || (caretakerId && loadingCaretaker)) return <LoadingState />;
  if (!currentUser && !guestMode)
    return (
      <AuthRequired
        message="Log in to request a booking."
        callbackPath={
          caretakerId ? `/booking/new?caretakerId=${caretakerId}` : "/booking/new"
        }
      />
    );
  if (!caretaker)
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Pick a caretaker first"
          description="Head to search, choose someone you like, and hit “Request booking.”"
          actionLabel="Browse caretakers"
          actionHref="/search"
        />
      </div>
    );

  const datesValid =
    draft.startDateTime &&
    draft.endDateTime &&
    new Date(draft.endDateTime) > new Date(draft.startDateTime);
  const outsideHours = datesValid
    ? stayProblem(caretaker.profile.availability, draft.startDateTime, draft.endDateTime)
    : null;
  const guestErrors: GuestErrors = guestMode
    ? { ...(attempted ? guestProblems(guest) : {}), ...guestServerErrors }
    : {};
  const whoValid = guestMode
    ? Object.keys(guestProblems(guest)).length === 0
    : draft.petIds.length > 0;
  const detailsValid = whoValid && draft.serviceType && datesValid && !outsideHours;
  const loginAgain = `/login?callbackUrl=${encodeURIComponent(`/booking/new?caretakerId=${caretakerId}`)}`;

  /** A picked day starts the stay at its first open hour; the end follows if it no longer fits. */
  function pickDay(date: string) {
    const first = caretaker?.profile.availability.find((d) => d.date === date)?.slots[0];
    if (!first) return;
    const startDateTime = `${date}T${first.start}`;
    const endStillFits = draft.endDateTime && new Date(draft.endDateTime) > new Date(startDateTime);
    draft.set({
      startDateTime,
      endDateTime: endStillFits ? draft.endDateTime : `${date}T${first.end}`,
    });
  }

  function goReview() {
    setAttempted(true);
    if (!detailsValid) {
      toast.error(
        outsideHours ??
          (guestMode
            ? "Check your details and your pet’s, then pick a service and dates."
            : "Add a pet, a service, and a valid date range to continue."),
      );
      return;
    }
    draft.set({ step: "review" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function confirmAsGuest() {
    if (!caretaker || !draft.serviceType) return;
    setSubmitting(true);
    const startDateTime = new Date(draft.startDateTime).toISOString();
    const endDateTime = new Date(draft.endDateTime).toISOString();
    try {
      const result = await bookCaretakerAsGuest({
        guest: toGuestContact(guest),
        pet: toGuestPet(guest),
        booking: {
          caretakerId: caretaker.profile.id,
          serviceType: draft.serviceType,
          startDateTime,
          endDateTime,
          notes: draft.notes,
          utcOffsetMinutes: utcOffsetMinutesAt(startDateTime),
        },
        saveAccount: guest.saveAccount,
      });
      draft.reset();
      const state: GuestRequestedState = {
        what: "booking",
        providerName: result.caretakerName,
        petName: result.petName,
        serviceLabel: SERVICE_LABELS[result.booking.serviceType],
        startDateTime: result.booking.startDateTime,
        endDateTime: result.booking.endDateTime,
        price: result.booking.priceTotal,
        email: guest.email.trim(),
        accountEmailSent: result.accountEmailSent,
        savedAccount: guest.saveAccount,
        devLink: result.devLink,
      };
      navigate("/booking/requested", { state });
    } catch (e) {
      setSubmitting(false);
      if (e instanceof ApiError && e.details?.code === "account_exists") {
        setAccountExists(true);
        draft.set({ step: "details" });
        return;
      }
      const fieldErrors = issueErrors(e);
      if (Object.keys(fieldErrors).length > 0) {
        setGuestServerErrors(fieldErrors);
        draft.set({ step: "details" });
      }
      toast.error("Couldn’t send that request", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  }

  async function confirm() {
    if (guestMode) return confirmAsGuest();
    if (!currentUser || !caretaker || !draft.serviceType) return;
    setSubmitting(true);
    try {
      const booking = await createBooking({
        caretakerId: caretaker.profile.id,
        petIds: draft.petIds,
        serviceType: draft.serviceType,
        // datetime-local is wall-clock time with no zone; the API wants an instant.
        startDateTime: new Date(draft.startDateTime).toISOString(),
        endDateTime: new Date(draft.endDateTime).toISOString(),
        notes: draft.notes,
        utcOffsetMinutes: utcOffsetMinutesAt(new Date(draft.startDateTime).toISOString()),
      });
      toast.success("Booking requested — we’ll notify you when it’s accepted.");
      draft.reset();
      navigate(`/booking/${booking.id}`);
    } catch (e) {
      toast.error("Couldn’t send that request", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-2 flex items-center gap-3">
        <Avatar src={caretaker.user.avatarUrl} alt={caretaker.user.name} size={40} />
        <div>
          <p className="text-sm text-charcoal/60">Requesting care with</p>
          <p className="font-semibold text-ink">{caretaker.user.name}</p>
        </div>
      </div>

      <ProgressLeash steps={STEPS} activeIndex={stepIndex} label="Booking step" className="my-4" />

      <div className="rounded-2xl border border-mist bg-white p-6">
        {draft.step === "details" && (
          <div className="space-y-6">
            {guestMode ? (
              <>
                {accountExists && (
                  <p
                    role="alert"
                    className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-charcoal"
                  >
                    You already have a Leash account with that email.{" "}
                    <Link to={loginAgain} className="font-medium text-leash underline">
                      Log in to book
                    </Link>
                    .
                  </p>
                )}
                <GuestDetailsForm
                  value={guest}
                  onChange={(next) => {
                    setGuest(next);
                    setGuestServerErrors({});
                    if (next.email !== guest.email) setAccountExists(false);
                  }}
                  errors={guestErrors}
                  providerName={caretaker.user.name.split(" ")[0]}
                />
              </>
            ) : (
            <div>
              <h2 className="text-lg font-semibold text-ink">Who needs care?</h2>
              <p className="mt-0.5 text-sm text-charcoal/60">
                Select one or more of your pets. Their full profile is attached
                automatically.
              </p>
              <div className="mt-3 space-y-2">
                {loadingPets ? (
                  <>
                    <PetCardSkeleton />
                    <PetCardSkeleton />
                  </>
                ) : pets && pets.length > 0 ? (
                  pets.map((pet) => (
                    <PetCard
                      key={pet.id}
                      pet={pet}
                      selected={draft.petIds.includes(pet.id)}
                      onSelect={() => draft.togglePet(pet.id)}
                    />
                  ))
                ) : (
                  <EmptyState
                    icon={<PawIcon width={36} height={36} />}
                    title="Add a pet to book care"
                    description="We’ll need your pet’s profile so your caretaker knows exactly how to help."
                    actionLabel="Add a pet"
                    actionHref="/dashboard/pets/new"
                  />
                )}
              </div>
              {attempted && draft.petIds.length === 0 && (
                <p className="mt-1.5 text-xs text-leash">Select at least one pet.</p>
              )}
            </div>
            )}

            <div>
              <h2 className="text-lg font-semibold text-ink">Which service?</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {caretaker.profile.servicesOffered.map((s) => {
                  const price = caretaker.profile.pricing.find((p) => p.serviceType === s);
                  const active = draft.serviceType === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => draft.set({ serviceType: s as ServiceType })}
                      aria-pressed={active}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors",
                        active
                          ? "border-ink bg-ink text-white"
                          : "border-mist bg-white text-charcoal hover:border-ink/40"
                      )}
                    >
                      <span className="font-medium">{SERVICE_LABELS[s]}</span>
                      {price && (
                        <span
                          className={cn(
                            "font-mono text-xs",
                            active ? "text-white/75" : "text-charcoal/55"
                          )}
                        >
                          {formatCurrency(price.rate)}/{price.unit}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-ink">When?</h2>
              <p className="mt-0.5 text-sm text-charcoal/60">
                Drop-off and pick-up need to fall in{" "}
                {caretaker.user.name.split(" ")[0]}’s open hours. Pick a day to see them.
              </p>
              <AvailabilityCalendar
                className="mt-3"
                availability={caretaker.profile.availability}
                selectedDate={draft.startDateTime ? draft.startDateTime.slice(0, 10) : undefined}
                onSelectDate={pickDay}
                emptyLabel={`${caretaker.user.name.split(" ")[0]} hasn’t opened any days yet, so there’s nothing to book.`}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="start" error={attempted && !draft.startDateTime ? "Required" : undefined}>
                <input
                  id="start"
                  type="datetime-local"
                  value={draft.startDateTime}
                  onChange={(e) => draft.set({ startDateTime: e.target.value })}
                  className="w-full rounded-xl border border-mist bg-white px-3.5 py-2.5 text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
                />
              </Field>
              <Field
                label="Ends"
                htmlFor="end"
                error={
                  attempted && draft.startDateTime && draft.endDateTime && !datesValid
                    ? "End must be after start"
                    : undefined
                }
              >
                <input
                  id="end"
                  type="datetime-local"
                  value={draft.endDateTime}
                  onChange={(e) => draft.set({ endDateTime: e.target.value })}
                  className="w-full rounded-xl border border-mist bg-white px-3.5 py-2.5 text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
                />
              </Field>
              {outsideHours && (
                <p role="alert" className="text-xs text-leash sm:col-span-2">
                  {outsideHours}
                </p>
              )}
            </div>

            <Field label="Notes for your caretaker" htmlFor="notes" hint="Optional">
              <Textarea
                id="notes"
                value={draft.notes}
                onChange={(e) => draft.set({ notes: e.target.value })}
                placeholder="Anything they should know — routines, quirks, gate codes…"
              />
            </Field>

            <div className="flex items-center justify-between border-t border-mist pt-5">
              <PriceHint units={units} total={total} unit={pricing?.unit} />
              <Button variant="cta" onClick={goReview}>
                Review request
              </Button>
            </div>
          </div>
        )}

        {draft.step === "review" && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-ink">Review your request</h2>
            <dl className="divide-y divide-mist rounded-xl border border-mist">
              <Row label="Caretaker" value={caretaker.user.name} />
              <Row
                label="Pets"
                value={
                  guestMode
                    ? guest.petName.trim() || "—"
                    : pets
                    ?.filter((p) => draft.petIds.includes(p.id))
                    .map((p) => p.name)
                    .join(", ") || "—"
                }
              />
              <Row
                label="Service"
                value={draft.serviceType ? SERVICE_LABELS[draft.serviceType] : "—"}
              />
              <Row
                label="When"
                value={
                  draft.startDateTime && draft.endDateTime
                    ? formatRange(draft.startDateTime, draft.endDateTime)
                    : "—"
                }
              />
              {draft.notes && <Row label="Notes" value={draft.notes} />}
            </dl>

            <div className="rounded-xl bg-fog p-4">
              <div className="flex items-center justify-between text-sm text-charcoal/75">
                <span>
                  {formatCurrency(pricing?.rate ?? 0)} × {units} {pricing?.unit}
                  {units === 1 ? "" : "s"}
                </span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-mist pt-2 text-base font-semibold text-ink">
                <span>Estimated total</span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
              <p className="mt-1 text-xs text-charcoal/50">
                Final platform fee is calculated at confirmation. You’re not
                charged until {caretaker.user.name.split(" ")[0]} accepts.
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-mist pt-5">
              <Button variant="ghost" onClick={() => draft.set({ step: "details" })}>
                Back
              </Button>
              <Button variant="cta" onClick={() => draft.set({ step: "confirm" })}>
                Continue to confirm
              </Button>
            </div>
          </div>
        )}

        {draft.step === "confirm" && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-ink">Confirm &amp; pay</h2>
            <p className="text-sm text-charcoal/60">
              This is a mock checkout — no real card is charged. Payment is only
              authorized once your caretaker accepts.
            </p>

            <div className="flex items-center justify-between rounded-xl border border-mist bg-white p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-12 items-center justify-center rounded-md bg-ink font-mono text-[10px] font-bold text-white">
                  VISA
                </span>
                <span className="font-mono text-sm text-charcoal">•••• 4242</span>
              </div>
              <span className="text-xs text-charcoal/50">Mock card</span>
            </div>

            <div className="rounded-xl bg-fog p-4">
              <div className="flex items-center justify-between text-base font-semibold text-ink">
                <span>Total to authorize</span>
                <span className="font-mono">{formatCurrency(total)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-mist pt-5">
              <Button
                variant="ghost"
                onClick={() => draft.set({ step: "review" })}
                disabled={submitting}
              >
                Back
              </Button>
              <Button variant="cta" size="lg" onClick={confirm} disabled={submitting}>
                {submitting ? "Sending request…" : "Confirm & request booking"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 text-center">
        <ButtonLink to={`/caretaker/${caretaker.profile.id}`} variant="ghost" size="sm">
          ← Back to {caretaker.user.name.split(" ")[0]}’s profile
        </ButtonLink>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <dt className="text-sm text-charcoal/60">{label}</dt>
      <dd className="max-w-[65%] text-right text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function PriceHint({
  units,
  total,
  unit,
}: {
  units: number;
  total: number;
  unit?: "hour" | "day";
}) {
  if (!units) return <span className="text-sm text-charcoal/50">Add dates for a price</span>;
  return (
    <div className="text-sm text-charcoal/70">
      <span className="font-mono text-lg font-semibold text-ink">
        {formatCurrency(total)}
      </span>{" "}
      <span className="text-charcoal/55">
        · {units} {unit}
        {units === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
    </div>
  );
}
