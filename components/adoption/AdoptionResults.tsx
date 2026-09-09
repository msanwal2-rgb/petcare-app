"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { EnergyLevel, Species } from "@/types";
import { searchListings } from "@/lib/api/adoptions";
import { useAsync } from "@/lib/hooks/useAsync";
import { AdoptionCard } from "./AdoptionCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { Field, Input } from "@/components/ui/Field";
import { coordsFor } from "@/lib/geo";
import { SPECIES_LABELS, SPECIES_OPTIONS } from "@/lib/utils";

/**
 * The adoption directory.
 *
 * Same shape as the caretaker and vet search pages — sticky filter rail, one
 * `ResultsGrid`, filters reset the page — but the ordering is different on
 * purpose: longest-waiting first, not newest. A directory that leads with new
 * arrivals is one where the animals who need it most are never seen.
 */

const ENERGY: EnergyLevel[] = ["low", "moderate", "high"];
const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low: "Low — a quiet life",
  moderate: "Moderate",
  high: "High — needs a job",
};

const PAGE_SIZE = 24;

export function AdoptionResults() {
  const params = useSearchParams();
  const [location, setLocation] = useState(params.get("location") ?? "");
  const [species, setSpecies] = useState(params.get("species") ?? "");
  const [energyLevel, setEnergyLevel] = useState("");
  const [goodWithKids, setGoodWithKids] = useState(false);
  const [goodWithDogs, setGoodWithDogs] = useState(false);
  const [goodWithCats, setGoodWithCats] = useState(false);
  const [page, setPage] = useState(0);

  const origin = useMemo(() => coordsFor(location), [location]);

  /** Any filter change starts again at the first page. */
  function onFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  const { data, loading } = useAsync(
    () =>
      searchListings({
        lat: origin?.lat,
        lng: origin?.lng,
        radiusMiles: origin ? 60 : undefined,
        species: (species || undefined) as Species | undefined,
        energyLevel: (energyLevel || undefined) as EnergyLevel | undefined,
        goodWithKids: goodWithKids ? "yes" : undefined,
        goodWithDogs: goodWithDogs ? "yes" : undefined,
        goodWithCats: goodWithCats ? "yes" : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    [
      origin?.lat,
      origin?.lng,
      species,
      energyLevel,
      goodWithKids,
      goodWithDogs,
      goodWithCats,
      page,
    ]
  );

  const items = data?.items ?? null;
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4 rounded-2xl border border-mist bg-white p-5">
            <Field label="Near" htmlFor="adopt-location">
              <Input
                id="adopt-location"
                value={location}
                onChange={(e) => onFilter(setLocation)(e.target.value)}
                placeholder="Austin, TX"
              />
            </Field>

            <SelectFilter
              id="adopt-species"
              label="Animal"
              anyLabel="Any animal"
              options={SPECIES_OPTIONS}
              optionLabel={(s) => SPECIES_LABELS[s]}
              value={species}
              onChange={onFilter(setSpecies)}
            />

            <SelectFilter
              id="adopt-energy"
              label="Energy"
              anyLabel="Any energy level"
              options={ENERGY}
              optionLabel={(e) => ENERGY_LABELS[e]}
              value={energyLevel}
              onChange={onFilter(setEnergyLevel)}
            />

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-charcoal/70">
                Must be good with
              </legend>
              {[
                ["Children", goodWithKids, setGoodWithKids] as const,
                ["Dogs", goodWithDogs, setGoodWithDogs] as const,
                ["Cats", goodWithCats, setGoodWithCats] as const,
              ].map(([label, value, set]) => (
                <label
                  key={label}
                  className="flex cursor-pointer items-center gap-2 text-sm text-charcoal"
                >
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => onFilter(set)(e.target.checked)}
                    className="h-4 w-4 accent-ink"
                  />
                  {label}
                </label>
              ))}
              <p className="pt-1 text-xs text-charcoal/55">
                These match a definite yes. An animal nobody has tested is not
                included — which is the honest answer, not a hidden one.
              </p>
            </fieldset>

            <button
              type="button"
              onClick={() => {
                setLocation("");
                setSpecies("");
                setEnergyLevel("");
                setGoodWithKids(false);
                setGoodWithDogs(false);
                setGoodWithCats(false);
                setPage(0);
              }}
              className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
            >
              Reset filters
            </button>
          </div>
        </aside>

        <div>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {location ? `Animals near ${location}` : "Animals looking for a home"}
            </h1>
            <p className="mt-1 font-mono text-sm text-charcoal/60">
              {total} waiting · longest first
            </p>
          </div>

          <ResultsGrid
            items={items}
            loading={loading}
            renderItem={(listing) => (
              <AdoptionCard key={listing.id} listing={listing} />
            )}
            skeleton={<PetCardSkeleton />}
            emptyTitle="No animals match"
            emptyDescription="Try widening the filters — or clearing 'must be good with', which excludes any animal nobody has tested yet."
          />
        </div>
      </div>
    </div>
  );
}
