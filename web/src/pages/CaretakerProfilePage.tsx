import { useEffect, useState, type FormEvent } from "react";
import type { CaretakerProfile, PricingEntry, ServiceType, Species } from "@/types";
import {
  getCaretakerProfileForUser,
  saveCaretakerProfile,
} from "@/api/caretakers";
import { listCaretakerBookings } from "@/api/bookings";
import type { Booking } from "@/types";
import { ApiError } from "@/api/_client";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSession } from "@/store/session";
import {
  BOOKING_STATUS_TONE,
  SERVICE_LABELS,
  SPECIES_LABELS,
  STATUS_LABELS,
  formatCurrency,
  formatRange,
} from "@/lib/utils";

/**
 * The caretaker's own side of the marketplace: the listing they publish, the
 * rate card that prices every booking, and the queue of requests waiting on
 * them.
 *
 * ── Three numbers are missing from this form on purpose ──
 *
 * Rating, review count and response rate are all derived from what the
 * caretaker has actually done. They are shown here, and there is no field for
 * them — the API has nowhere to put one either. A marketplace where the seller
 * types their own rating is not a marketplace.
 */
export default function CaretakerProfilePage() {
  const { currentUser } = useSession();
  const userId = currentUser!.id;

  const [profile, setProfile] = useState<CaretakerProfile | null | undefined>(
    undefined,
  );
  const [queue, setQueue] = useState<Booking[]>([]);

  useEffect(() => {
    getCaretakerProfileForUser(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

  useEffect(() => {
    if (!profile) return;
    listCaretakerBookings(profile.id, { limit: 10 })
      .then((page) => setQueue(page.items))
      .catch(() => setQueue([]));
  }, [profile]);

  if (profile === undefined) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Your caretaker listing</h1>
        <p className="mt-1 text-sm text-charcoal/60">
          {profile === null
            ? "You don't have a listing yet. Filling this in publishes one."
            : "What owners see when they find you in search."}
        </p>
      </div>

      {profile && (
        <section className="grid gap-4 sm:grid-cols-3">
          <Derived label="Rating" value={`${profile.rating.toFixed(1)} ★`} />
          <Derived label="Reviews" value={String(profile.reviewCount)} />
          <Derived label="Response rate" value={`${profile.responseRatePct}%`} />
        </section>
      )}

      <ProfileForm profile={profile} userId={userId} onSaved={setProfile} />

      {profile && (
        <section className="rounded-2xl border border-mist bg-white p-6">
          <h2 className="text-lg font-semibold text-ink">Requests</h2>
          <p className="mt-1 text-sm text-charcoal/60">
            Answering these — either way — is what moves your response rate.
          </p>

          {queue.length === 0 ? (
            <p className="mt-4 text-sm text-charcoal/60">Nothing waiting on you.</p>
          ) : (
            <ul className="mt-5 space-y-3">
              {queue.map((booking) => (
                <li key={booking.id}>
                  <ButtonLink
                    to={`/booking/${booking.id}`}
                    variant="outline"
                    className="flex w-full items-center justify-between gap-3 !rounded-xl !px-4 !py-3"
                  >
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm text-ink">
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
          )}
        </section>
      )}
    </div>
  );
}

function ProfileForm({
  profile,
  userId,
  onSaved,
}: {
  profile: CaretakerProfile | null;
  userId: string;
  onSaved: (profile: CaretakerProfile) => void;
}) {
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [radius, setRadius] = useState(profile?.serviceRadiusMiles ?? 10);
  const [services, setServices] = useState<ServiceType[]>(
    profile?.servicesOffered ?? [],
  );
  const [species, setSpecies] = useState<Species[]>(profile?.acceptedSpecies ?? []);
  const [pricing, setPricing] = useState<PricingEntry[]>(profile?.pricing ?? []);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  function rateFor(service: ServiceType): PricingEntry | undefined {
    return pricing.find((p) => p.serviceType === service);
  }

  function setRate(service: ServiceType, rate: number) {
    setPricing((current) => {
      const existing = current.find((p) => p.serviceType === service);
      if (existing) {
        return current.map((p) => (p.serviceType === service ? { ...p, rate } : p));
      }
      // Boarding and daycare are priced by the day; the rest by the hour.
      const unit = service === "boarding" || service === "daycare" ? "day" : "hour";
      return [...current, { serviceType: service, unit, rate }];
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    setIssues({});

    try {
      // Only the services actually offered keep a rate line — sending a rate
      // for something you do not do would put it in the price range that search
      // filters on.
      const kept = pricing.filter((p) => services.includes(p.serviceType));

      onSaved(
        await saveCaretakerProfile(userId, {
          bio,
          serviceRadiusMiles: radius,
          servicesOffered: services,
          acceptedSpecies: species,
          pricing: kept,
        }),
      );
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        setIssues(Object.fromEntries(err.issues.map((i) => [i.path, i.message])));
      } else {
        setError(err instanceof Error ? err.message : "Could not save");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border border-mist bg-white p-6"
      noValidate
    >
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {error}
        </p>
      )}

      <Field label="About you" htmlFor="bio" error={issues.bio}>
        <Textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Former vet-tech turned full-time dog walker."
        />
      </Field>

      <Field
        label="Service radius"
        hint="miles"
        htmlFor="radius"
        error={issues.serviceRadiusMiles}
      >
        <Input
          id="radius"
          type="number"
          min={1}
          max={200}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">
          Services and rates
        </legend>
        {issues.pricing && (
          <p className="mb-2 text-xs text-leash">{issues.pricing}</p>
        )}
        <ul className="space-y-2">
          {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((service) => {
            const offered = services.includes(service);
            const entry = rateFor(service);
            return (
              <li
                key={service}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-mist px-4 py-3"
              >
                <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={offered}
                    onChange={(e) =>
                      setServices((current) =>
                        e.target.checked
                          ? [...current, service]
                          : current.filter((s) => s !== service),
                      )
                    }
                  />
                  <span className="text-ink">{SERVICE_LABELS[service]}</span>
                </label>

                {offered && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={entry?.rate ?? ""}
                      onChange={(e) => setRate(service, Number(e.target.value))}
                      className="w-24"
                      aria-label={`${SERVICE_LABELS[service]} rate`}
                    />
                    <span className="text-xs text-charcoal/55">
                      / {entry?.unit ?? "hour"}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Pets you take</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SPECIES_LABELS) as Species[]).map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-mist px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={species.includes(s)}
                onChange={(e) =>
                  setSpecies((current) =>
                    e.target.checked
                      ? [...current, s]
                      : current.filter((x) => x !== s),
                  )
                }
              />
              <span className="text-ink">{SPECIES_LABELS[s]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" variant="cta" disabled={saving}>
          {saving ? "Saving…" : profile ? "Save listing" : "Publish listing"}
        </Button>
        {saved && <span className="text-sm text-charcoal/60">Saved.</span>}
      </div>
    </form>
  );
}

function Derived({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-mist bg-white p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink">{value}</p>
      <p className="mt-1 text-[10px] text-charcoal/45">Earned, not set</p>
    </div>
  );
}
