"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { getCaretakerById } from "@/lib/api/caretakers";
import { getPetsByOwner } from "@/lib/api/pets";
import { createBooking } from "@/lib/api/bookings";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { useBookingDraft } from "@/lib/store/booking-draft";
import type { ServiceType } from "@/types";
import { BookingProgressLeash } from "@/components/BookingProgressLeash";
import { PetCard } from "@/components/PetCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { AuthRequired } from "@/components/AuthRequired";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
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

export function BookingNewClient() {
  const params = useSearchParams();
  const caretakerId = params.get("caretakerId") ?? "";
  const router = useRouter();
  const { currentUser, hasHydrated } = useSession();
  const draft = useBookingDraft();
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const { data: caretaker, loading: loadingCaretaker } = useAsync(
    () => (caretakerId ? getCaretakerById(caretakerId) : Promise.resolve(null)),
    [caretakerId]
  );
  const { data: pets, loading: loadingPets } = useAsync(
    () => (currentUser ? getPetsByOwner(currentUser.id) : Promise.resolve([])),
    [currentUser?.id]
  );

  // Initialize the draft for this caretaker once loaded.
  useEffect(() => {
    if (caretaker && draft.caretakerId !== caretaker.id) {
      draft.reset(caretaker.id);
      draft.set({ serviceType: caretaker.servicesOffered[0] ?? null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretaker]);

  const pricing = useMemo(
    () =>
      caretaker?.pricing.find((p) => p.serviceType === draft.serviceType) ?? null,
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
  if (!currentUser)
    return (
      <AuthRequired message="Log in to request a booking. You can use the Dev account switcher to try it instantly." />
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
  const detailsValid = draft.petIds.length > 0 && draft.serviceType && datesValid;

  function goReview() {
    setAttempted(true);
    if (!detailsValid) {
      toast.error("Add a pet, a service, and a valid date range to continue.");
      return;
    }
    draft.set({ step: "review" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function confirm() {
    if (!currentUser || !caretaker || !draft.serviceType) return;
    setSubmitting(true);
    try {
      const booking = await createBooking({
        ownerId: currentUser.id,
        caretakerId: caretaker.id,
        petIds: draft.petIds,
        serviceType: draft.serviceType,
        startDateTime: draft.startDateTime,
        endDateTime: draft.endDateTime,
        notes: draft.notes,
        priceTotal: total,
      });
      toast.success("Booking requested — we’ll notify you when it’s accepted.");
      draft.reset();
      router.push(`/booking/${booking.id}`);
    } catch {
      toast.error("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="mb-2 flex items-center gap-3">
        <div className="relative h-10 w-10 overflow-hidden rounded-full">
          <Image
            src={caretaker.user.avatarUrl}
            alt={caretaker.user.name}
            fill
            sizes="40px"
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            className="object-cover"
          />
        </div>
        <div>
          <p className="text-sm text-charcoal/60">Requesting care with</p>
          <p className="font-semibold text-ink">{caretaker.user.name}</p>
        </div>
      </div>

      <BookingProgressLeash steps={STEPS} activeIndex={stepIndex} className="my-4" />

      <div className="rounded-2xl border border-mist bg-white p-6">
        {draft.step === "details" && (
          <div className="space-y-6">
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

            <div>
              <h2 className="text-lg font-semibold text-ink">Which service?</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {caretaker.servicesOffered.map((s) => {
                  const price = caretaker.pricing.find((p) => p.serviceType === s);
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
                  pets
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
        <ButtonLink href={`/caretaker/${caretaker.id}`} variant="ghost" size="sm">
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
