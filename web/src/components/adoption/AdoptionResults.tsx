import { useSearchParams } from "react-router";
import { useState } from "react";
import type { EnergyLevel, Species } from "@/types";
import { searchListings, type AdoptionListingPage, type ListingFilters } from "@/api/adoptions";
import { useAsync } from "@/hooks/useAsync";
import { AdoptionCard } from "./AdoptionCard";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";
import { Button } from "@/components/ui/Button";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { Field, Select } from "@/components/ui/Field";
import { CITIES, cityById } from "@/lib/cities";
import { SPECIES_LABELS, SPECIES_OPTIONS } from "@/lib/utils";

/**
 * The adoption directory — the reference's `components/adoption/AdoptionResults.tsx`.
 *
 * Same shape as the caretaker and vet searches, with the ordering different on
 * purpose: longest-waiting first, not newest. A directory that leads with new
 * arrivals is one where the animals who need it most are never seen.
 *
 * Adapted the way the vet search was:
 *  - **"Near" is a city picker** over `lib/cities.ts`, not free text.
 *  - **Filters live in the URL**, so a search survives a reload.
 *  - **Results are cursor pages** with "Show more", where the reference paged
 *    by offset. "N waiting" is the server's total for the filters as given.
 */

const ENERGY: EnergyLevel[] = ["low", "moderate", "high"];
const ENERGY_LABELS: Record<EnergyLevel, string> = {
  low: "Low — a quiet life",
  moderate: "Moderate",
  high: "High — needs a job",
};

const RADIUS_MILES = 60;
const PAGE_SIZE = 24;
const GOOD_WITH = [
  ["Children", "goodWithKids"],
  ["Dogs", "goodWithDogs"],
  ["Cats", "goodWithCats"],
] as const;

export function AdoptionResults() {
  const [params, setParams] = useSearchParams();
  const cityId = params.get("city") ?? "";
  const species = params.get("species") ?? "";
  const energyLevel = params.get("energyLevel") ?? "";
  const city = cityById(cityId);

  const query: ListingFilters = {
    lat: city?.lat,
    lng: city?.lng,
    radiusMiles: city ? RADIUS_MILES : undefined,
    species: (species || undefined) as Species | undefined,
    energyLevel: (energyLevel || undefined) as EnergyLevel | undefined,
    goodWithKids: params.get("goodWithKids") === "yes" ? "yes" : undefined,
    goodWithDogs: params.get("goodWithDogs") === "yes" ? "yes" : undefined,
    goodWithCats: params.get("goodWithCats") === "yes" ? "yes" : undefined,
    limit: PAGE_SIZE,
  };

  const filterKey = params.toString();
  const [more, setMore] = useState<{ key: string; pages: AdoptionListingPage[] }>({ key: "", pages: [] });
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading } = useAsync(() => searchListings(query), [filterKey]);

  const extra = more.key === filterKey ? more.pages : [];
  const pages = data ? [data, ...extra] : [];
  const items = pages.flatMap((p) => p.items);
  const cursor = pages.length > 0 ? pages[pages.length - 1].nextCursor : null;
  const total = data?.total ?? 0;

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await searchListings({ ...query, cursor });
      setMore({ key: filterKey, pages: [...extra, page] });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-4 rounded-2xl border border-mist bg-white p-5">
            <Field label="Near" htmlFor="adopt-location">
              <Select
                id="adopt-location"
                value={city ? cityId : ""}
                onChange={(e) => setFilter("city", e.target.value)}
              >
                <option value="">Anywhere</option>
                {CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>

            <SelectFilter
              id="adopt-species"
              label="Animal"
              anyLabel="Any animal"
              options={SPECIES_OPTIONS}
              optionLabel={(s) => SPECIES_LABELS[s]}
              value={species}
              onChange={(v) => setFilter("species", v)}
            />

            <SelectFilter
              id="adopt-energy"
              label="Energy"
              anyLabel="Any energy level"
              options={ENERGY}
              optionLabel={(e) => ENERGY_LABELS[e]}
              value={energyLevel}
              onChange={(v) => setFilter("energyLevel", v)}
            />

            <fieldset className="space-y-2">
              <legend className="mb-1 text-xs font-medium text-charcoal/70">Must be good with</legend>
              {GOOD_WITH.map(([label, key]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-charcoal">
                  <input
                    type="checkbox"
                    checked={params.get(key) === "yes"}
                    onChange={(e) => setFilter(key, e.target.checked ? "yes" : "")}
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
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
              className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
            >
              Reset filters
            </button>
          </div>
        </aside>

        <div>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {city ? `Animals near ${city.label}` : "Animals looking for a home"}
            </h1>
            <p className="mt-1 font-mono text-sm text-charcoal/60">{total} waiting · longest first</p>
          </div>

          <ResultsGrid
            items={loading || !data ? null : items.map((item) => ({ id: item.listing.id, item }))}
            loading={loading}
            renderItem={({ item }) => <AdoptionCard item={item} />}
            skeleton={<PetCardSkeleton />}
            emptyTitle="No animals match"
            emptyDescription="Try widening the filters — or clearing 'must be good with', which excludes any animal nobody has tested yet."
          />

          {!loading && cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
