import { useParams } from "react-router";
import { useState } from "react";
import { getVet, getVetReviewsForUser } from "@/api/vets";
import { getUsersByIds } from "@/api/users";
import { useAsync } from "@/hooks/useAsync";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { EmptyState } from "@/components/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/ui/Reveal";
import { ProfileHero, ProfilePageSkeleton } from "@/components/ui/ProfileHero";
import { Skeleton } from "@/components/ui/Skeleton";
import { Panel, Stat } from "@/components/ui/Panel";
import { ClockIcon, AlertIcon, StethoscopeIcon } from "@/components/ui/icons";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  SPECIES_LABELS,
  formatCurrency,
} from "@/lib/utils";

/**
 * A clinic's public profile — the reference's `app/vets/[id]/page.tsx`.
 *
 * One difference: the emergency panel's number is the clinic's own line
 * (`clinic.phone`), where the reference printed the vet's personal phone —
 * its endpoint returned the whole `User`, email included, to anyone. Until a
 * vet sets a clinic number the panel names the clinic without one.
 */
export default function VetDetailPage() {
  const { id = "" } = useParams();
  const [selectedDate, setSelectedDate] = useState<string>();

  const { data: vet, loading } = useAsync(() => getVet(id), [id]);
  const { data: reviews } = useAsync(
    () =>
      vet ? getVetReviewsForUser(vet.user.id) : Promise.resolve([]),
    [vet?.user.id]
  );
  const { data: authors } = useAsync(
    () =>
      reviews?.length
        ? getUsersByIds([...new Set(reviews.map((r) => r.fromUserId))])
        : Promise.resolve([]),
    [reviews]
  );

  if (loading || vet === null) {
    return vet === null && !loading ? (
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
        <EmptyState
          title="Vet not found"
          description="This clinic may no longer be listed. Try browsing the others."
          actionLabel="Back to vets"
          actionHref="/vets"
        />
      </div>
    ) : (
      <ProfilePageSkeleton />
    );
  }

  const { profile, user } = vet;
  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Reveal className="overflow-hidden rounded-3xl border border-mist bg-white">
        <ProfileHero
          imageUrl={user.avatarUrl}
          name={user.name}
          // The shield next to a vet's name means their *licence* has been
          // checked, not that they confirmed an email address. Those are very
          // different claims, and an owner choosing who treats their animal
          // will read it as the first one.
          verified={profile.verificationStatus === "verified"}
          subtitle={profile.clinicName}
          city={profile.clinic.city}
          state={profile.clinic.state}
          rating={profile.rating}
          reviewCount={profile.reviewCount}
        />
      </Reveal>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <Reveal>
            <div className="flex flex-wrap gap-2">
              {profile.specialties.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center gap-1.5 rounded-full border border-mist bg-white px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-charcoal"
                >
                  <StethoscopeIcon width={13} height={13} className="text-ink" />
                  {SPECIALTY_LABELS[s]}
                </span>
              ))}
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-charcoal/85">{profile.bio}</p>
          </Reveal>

          {profile.emergencyAvailable && (
            <Reveal>
              <div className="flex items-start gap-3 rounded-2xl border border-leash/30 bg-leash/5 p-4">
                <AlertIcon width={20} height={20} className="mt-0.5 shrink-0 text-leash" />
                <div>
                  <p className="text-sm font-medium text-ink">Takes emergencies</p>
                  <p className="mt-0.5 text-sm text-charcoal/75">
                    For a life-threatening emergency, call the clinic directly
                    {profile.clinic.phone ? (
                      <>
                        {" "}at{" "}
                        <a
                          href={`tel:${profile.clinic.phone.replace(/[^\d+]/g, "")}`}
                          className="font-medium text-ink underline underline-offset-2"
                        >
                          {profile.clinic.phone}
                        </a>
                      </>
                    ) : null}{" "}
                    rather than booking online.
                  </p>
                </div>
              </div>
            </Reveal>
          )}

          <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Experience" value={`${profile.yearsExperience} yrs`} />
            <Stat label="Response rate" value={`${profile.responseRatePct}%`} />
            <Stat label="Reviews" value={String(profile.reviewCount)} />
            <Stat label="Licensed in" value={profile.licenseState} />
          </Reveal>

          <Reveal className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Panel title="Treats">
              <div className="flex flex-wrap gap-2">
                {profile.acceptedSpecies.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-mist bg-fog px-3 py-1 text-sm text-charcoal"
                  >
                    {SPECIES_LABELS[s]}s
                  </span>
                ))}
              </div>
            </Panel>
            <Panel title="Consultation formats">
              <div className="flex flex-wrap gap-2">
                {profile.consultModes.map((m) => (
                  <span
                    key={m}
                    className="rounded-full border border-mist bg-fog px-3 py-1 text-sm text-charcoal"
                  >
                    {CONSULT_MODE_LABELS[m]}
                  </span>
                ))}
              </div>
            </Panel>
            <Panel title="Credentials" className="sm:col-span-2">
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4 border-b border-mist/70 pb-2">
                  <dt className="text-charcoal/65">Licence number</dt>
                  <dd className="font-mono text-ink">{profile.licenseNumber}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-mist/70 pb-2">
                  <dt className="text-charcoal/65">Licensing state</dt>
                  <dd className="font-mono text-ink">{profile.licenseState}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-charcoal/65">Clinic</dt>
                  <dd className="text-ink">{profile.clinicName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-charcoal/65">Years in practice</dt>
                  <dd className="font-mono text-ink">{profile.yearsExperience}</dd>
                </div>
              </dl>
            </Panel>
          </Reveal>

          <Reveal>
            <h2 className="text-lg font-semibold text-ink">Availability</h2>
            <p className="mb-3 mt-1 text-sm text-charcoal/60">
              Tap an open day to see available times.
            </p>
            <AvailabilityCalendar
              availability={profile.availability}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          </Reveal>

          <Reveal>
            <h2 className="text-lg font-semibold text-ink">
              Reviews{" "}
              <span className="font-mono text-sm font-normal text-charcoal/50">
                ({profile.reviewCount})
              </span>
            </h2>
            <div className="mt-4 space-y-4">
              {reviews === null ? (
                <>
                  <Skeleton className="h-28 w-full rounded-[12px]" />
                  <Skeleton className="h-28 w-full rounded-[12px]" />
                </>
              ) : reviews.length === 0 ? (
                <p className="rounded-[12px] border border-dashed border-mist bg-white/60 px-4 py-8 text-center text-sm text-charcoal/60">
                  No written reviews yet — be the first after your visit.
                </p>
              ) : (
                reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    author={authorById.get(r.fromUserId)}
                  />
                ))
              )}
            </div>
          </Reveal>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-6 shadow-sm">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-3xl font-semibold text-ink">
                {formatCurrency(profile.consultFee)}
              </span>
              <span className="text-charcoal/55">per consultation</span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-charcoal/60">
              <ClockIcon width={15} height={15} />
              Confirms {profile.responseRatePct}% of requests
            </p>
            <ButtonLink
              to={`/vets/book?vetId=${profile.id}${selectedDate ? `&date=${selectedDate}` : ""}`}
              variant="cta"
              size="lg"
              className="mt-5 w-full"
            >
              Request appointment
            </ButtonLink>
            <p className="mt-3 text-center text-xs text-charcoal/50">
              {user.name.split(" ").slice(-1)[0]} confirms before anything is booked.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
