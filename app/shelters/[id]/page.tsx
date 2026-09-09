"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getShelterById } from "@/lib/api/shelters";
import { searchListings } from "@/lib/api/adoptions";
import { useAsync } from "@/lib/hooks/useAsync";
import { AdoptionCard } from "@/components/adoption/AdoptionCard";
import { EmptyState } from "@/components/EmptyState";
import { Panel, Stat } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ShelterPage() {
  const { id } = useParams<{ id: string }>();

  const { data: shelter, loading } = useAsync(() => getShelterById(id), [id]);
  const { data: listings, loading: loadingListings } = useAsync(
    () => searchListings({ shelterId: id, limit: 60 }),
    [id]
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!shelter) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="No such shelter"
          description="It may have closed its account."
          actionLabel="Browse adoptions"
          actionHref="/adopt"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link
        href="/adopt"
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← All animals
      </Link>

      <div className="mt-4 rounded-2xl border border-mist bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {shelter.name}
              </h1>
              {shelter.verificationStatus === "verified" && (
                <StatusBadge tone="done" label="Verified" />
              )}
            </div>
            <p className="mt-1 text-sm text-charcoal/70">
              {shelter.address.city}, {shelter.address.state}
              {shelter.phone && ` · ${shelter.phone}`}
            </p>
          </div>
          {shelter.websiteUrl && (
            <a
              href={shelter.websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
            >
              Their website ↗
            </a>
          )}
        </div>

        {shelter.bio && (
          <p className="mt-4 whitespace-pre-line text-charcoal/80">{shelter.bio}</p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Animals available" value={String(shelter.availableCount)} />
          <Stat label="Answers applications" value={`${shelter.responseRatePct}%`} />
          <Stat
            label="Registered"
            value={shelter.registrationNumber || "—"}
          />
        </div>
      </div>

      {shelter.adoptionPolicy && (
        <Panel title="What to expect" className="mt-4">
          <p className="whitespace-pre-line text-sm text-charcoal/80">
            {shelter.adoptionPolicy}
          </p>
        </Panel>
      )}

      <h2 className="mt-8 text-lg font-semibold text-ink">
        Animals looking for homes
      </h2>
      <div className="mt-4">
        <ResultsGrid
          items={listings?.items ?? null}
          loading={loadingListings}
          renderItem={(listing) => (
            <AdoptionCard key={listing.id} listing={listing} />
          )}
          skeleton={<PetCardSkeleton />}
          skeletonCount={3}
          emptyTitle="Nothing listed right now"
          emptyDescription="Every animal here has found a home. Check back soon."
        />
      </div>
    </div>
  );
}
