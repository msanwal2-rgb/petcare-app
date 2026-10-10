import { useParams } from "react-router";
import { useState, type ReactNode } from "react";
import { getCaretaker, getReviewsForUser } from "@/api/caretakers";
import { getUsersByIds } from "@/api/users";
import { useAsync } from "@/hooks/useAsync";
import { ServiceTypeChip } from "@/components/ServiceTypeChip";
import { AvailabilityCalendar } from "@/components/AvailabilityCalendar";
import { ReviewCard } from "@/components/ReviewCard";
import { EmptyState } from "@/components/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { Panel, Stat } from "@/components/ui/Panel";
import { ProfileHero, ProfilePageSkeleton } from "@/components/ui/ProfileHero";
import { CheckIcon, ClockIcon } from "@/components/ui/icons";
import {
  SERVICE_LABELS,
  SPECIES_LABELS,
  formatCurrency,
  cn,
} from "@/lib/utils";

/**
 * A caretaker's public profile — the reference's `app/caretaker/[id]/page.tsx`.
 *
 * The API nests the profile and the person (`{ profile, user, priceRange }`)
 * where the reference flattened them; otherwise unchanged. Reviews are asked
 * for by kind, so a caretaker who is also a vet shows only their care reviews.
 */
export default function CaretakerDetailPage() {
  const { id = "" } = useParams();
  const [selectedDate, setSelectedDate] = useState<string>();

  const { data: caretaker, loading } = useAsync(
    () => getCaretaker(id),
    [id]
  );
  const { data: reviews } = useAsync(
    () =>
      caretaker
        ? getReviewsForUser(caretaker.user.id, "booking")
        : Promise.resolve([]),
    [caretaker?.user.id]
  );
  const { data: authors } = useAsync(
    () =>
      reviews && reviews.length
        ? getUsersByIds([...new Set(reviews.map((r) => r.fromUserId))])
        : Promise.resolve([]),
    [reviews]
  );

  if (loading || caretaker === null) {
    return caretaker === null && !loading ? (
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
        <EmptyState
          title="Caretaker not found"
          description="This caretaker may have removed their profile. Try browsing others."
          actionLabel="Back to search"
          actionHref="/search"
        />
      </div>
    ) : (
      <ProfilePageSkeleton />
    );
  }

  const { profile, user, priceRange } = caretaker;
  const authorMap = new Map((authors ?? []).map((a) => [a.id, a]));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      {/* Header */}
      <Reveal className="overflow-hidden rounded-3xl border border-mist bg-white">
        <ProfileHero
          imageUrl={user.avatarUrl}
          name={user.name}
          // Background check, not email confirmation — see the note on the vet
          // profile for why the distinction matters here.
          verified={profile.backgroundCheckStatus === "verified"}
          city={user.address.city}
          state={user.address.state}
          rating={profile.rating}
          reviewCount={profile.reviewCount}
        />
      </Reveal>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="space-y-8">
          <Reveal>
            <div className="flex flex-wrap gap-2">
              {profile.servicesOffered.map((s) => (
                <ServiceTypeChip key={s} service={s} />
              ))}
            </div>
            <p className="mt-5 text-[15px] leading-relaxed text-charcoal/85">
              {profile.bio}
            </p>
          </Reveal>

          {/* Trust row */}
          <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Response rate"
              value={`${profile.responseRatePct}%`}
            />
            <Stat label="Reviews" value={String(profile.reviewCount)} />
            <Stat
              label="Service radius"
              value={`${profile.serviceRadiusMiles} mi`}
            />
            <Stat
              label="Background"
              value={
                profile.backgroundCheckStatus === "verified"
                  ? "Verified"
                  : profile.backgroundCheckStatus === "pending"
                    ? "Pending"
                    : "—"
              }
            />
          </Reveal>

          {/* Pricing */}
          <Reveal>
            <h2 className="text-lg font-semibold text-ink">Services &amp; pricing</h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-mist bg-white">
              {profile.pricing.map((p, i) => (
                <div
                  key={p.serviceType}
                  className={cn(
                    "flex items-center justify-between px-5 py-3.5",
                    i > 0 && "border-t border-mist"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <ServiceTypeChip service={p.serviceType} size="sm" />
                    <span className="text-sm text-charcoal">
                      {SERVICE_LABELS[p.serviceType]}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-medium text-ink">
                    {formatCurrency(p.rate)}
                    <span className="text-charcoal/50">/{p.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Home & care details */}
          <Reveal className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <Panel title="Accepts">
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
            <Panel title="Home environment">
              <ul className="space-y-1.5 text-sm text-charcoal/80">
                <EnvItem ok={profile.homeEnvironment.fencedYard}>
                  Fenced yard
                </EnvItem>
                <EnvItem ok={profile.homeEnvironment.smokeFree}>
                  Smoke-free home
                </EnvItem>
                <EnvItem ok={profile.homeEnvironment.hasOtherPets}>
                  Other pets in home
                </EnvItem>
              </ul>
            </Panel>
            {profile.certifications.length > 0 && (
              <Panel title="Certifications" className="sm:col-span-2">
                <div className="flex flex-wrap gap-2">
                  {profile.certifications.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center gap-1.5 rounded-full bg-ink/5 px-3 py-1 text-sm text-ink"
                    >
                      <CheckIcon width={14} height={14} className="text-[#2F6F5E]" />
                      {c}
                    </span>
                  ))}
                </div>
              </Panel>
            )}
          </Reveal>

          {/* Availability */}
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

          {/* Reviews */}
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
                  No written reviews yet — be the first after your booking.
                </p>
              ) : (
                reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    author={authorMap.get(r.fromUserId)}
                  />
                ))
              )}
            </div>
          </Reveal>
        </div>

        {/* Sticky booking CTA */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-6 shadow-sm">
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-3xl font-semibold text-ink">
                {formatCurrency(priceRange.min)}
              </span>
              <span className="text-charcoal/55">
                /{profile.pricing[0]?.unit ?? "hour"} and up
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-charcoal/60">
              <ClockIcon width={15} height={15} />
              Usually responds in under an hour
            </p>
            <ButtonLink
              to={`/booking/new?caretakerId=${profile.id}`}
              variant="cta"
              size="lg"
              className="mt-5 w-full"
            >
              Request booking
            </ButtonLink>
            <p className="mt-3 text-center text-xs text-charcoal/50">
              You won’t be charged until {user.name.split(" ")[0]} accepts.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function EnvItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full",
          ok ? "bg-[#2F6F5E]/15 text-[#215144]" : "bg-mist text-charcoal/40"
        )}
      >
        {ok ? <CheckIcon width={11} height={11} /> : <span className="text-[10px]">–</span>}
      </span>
      <span className={cn(!ok && "text-charcoal/45 line-through")}>{children}</span>
    </li>
  );
}
