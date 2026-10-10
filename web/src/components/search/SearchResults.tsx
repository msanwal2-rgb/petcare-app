import { useSearchParams } from "react-router";
import { useState } from "react";
import type { ServiceType, Species } from "@/types";
import {
  searchCaretakers,
  type CaretakerSearchPage,
  type CaretakerSearchParams,
} from "@/api/caretakers";
import { useAsync } from "@/hooks/useAsync";
import { CaretakerCard, CaretakerCardSkeleton } from "@/components/CaretakerCard";
import { SearchBar } from "@/components/SearchBar";
import { Button } from "@/components/ui/Button";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { Field } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { cityById } from "@/lib/cities";
import {
  SERVICE_LABELS,
  SERVICE_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
  formatCurrency,
} from "@/lib/utils";

/** The slider's top stop means "no ceiling", as in the reference. */
const ANY_PRICE = 100;
const PAGE_SIZE = 12;
/** The reference's caretaker search radius around a city. */
const RADIUS_MILES = 40;

/**
 * The reference's `components/search/SearchResults.tsx`. Three differences,
 * all in what the controls are wired to:
 *
 *  - **The place is a city, not free text.** `?city=austin` resolves through
 *    `lib/cities.ts` to coordinates, which switches the server to nearest-first
 *    and puts a distance on every card. The reference's location box filtered
 *    nothing (see `SearchBar`).
 *  - **The filters live in the URL**, so a search can be shared and reloaded and
 *    the hero's search bar can hand off to it. The reference kept them in
 *    component state seeded once from the URL, so a second search from the
 *    inline bar left the old service filter in place.
 *  - **Results are cursor pages.** The count is what has loaded so far, and
 *    "Show more" fetches the next page — the API never counts the whole set,
 *    because that would double the cost of every search.
 */
export function SearchResults() {
  const [params, setParams] = useSearchParams();
  const cityId = params.get("city") ?? "";
  const startDate = params.get("startDate") ?? "";
  const service = params.get("serviceType") ?? "";
  const species = params.get("species") ?? "";
  const maxPrice = Number(params.get("maxPrice") ?? ANY_PRICE) || ANY_PRICE;

  // An unknown `?city=` is ignored rather than refused — a stale link should
  // still show results, just not narrowed to a place that no longer exists.
  const city = cityById(cityId);

  const query: CaretakerSearchParams = {
    lat: city?.lat,
    lng: city?.lng,
    radiusMiles: city ? RADIUS_MILES : undefined,
    serviceType: (service || undefined) as ServiceType | undefined,
    species: (species || undefined) as Species | undefined,
    startDate: startDate || undefined,
    maxPrice: maxPrice < ANY_PRICE ? maxPrice : undefined,
    limit: PAGE_SIZE,
  };

  // Extra pages appended by "Show more", reset whenever the filters change —
  // a new filter is a new result set, not more of the old one.
  const [more, setMore] = useState<{ key: string; pages: CaretakerSearchPage[] }>({
    key: "",
    pages: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const filterKey = params.toString();

  const { data, loading } = useAsync(
    () => searchCaretakers(query),
    [filterKey]
  );

  const extra = more.key === filterKey ? more.pages : [];
  const pages = data ? [data, ...extra] : [];
  const results = pages.flatMap((p) => p.items);
  const cursor = pages.length > 0 ? pages[pages.length - 1].nextCursor : null;

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
      const page = await searchCaretakers({ ...query, cursor });
      setMore({ key: filterKey, pages: [...extra, page] });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="mb-6">
        <SearchBar
          // Keyed so a search from the hero, or Back, re-seeds the bar.
          key={`${cityId}|${service}|${startDate}`}
          variant="inline"
          initial={{ city: cityId, serviceType: service, startDate }}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        {/* Filters */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">Filters</h2>
            <div className="mt-4 space-y-4">
              <SelectFilter
                id="f-service"
                label="Service"
                anyLabel="Any service"
                options={SERVICE_OPTIONS}
                optionLabel={(s) => SERVICE_LABELS[s]}
                value={service}
                onChange={(v) => setFilter("serviceType", v)}
              />

              <SelectFilter
                id="f-species"
                label="Pet type"
                anyLabel="Any pet"
                options={SPECIES_OPTIONS}
                optionLabel={(s) => SPECIES_LABELS[s]}
                value={species}
                onChange={(v) => setFilter("species", v)}
              />

              <Field
                label="Max price"
                htmlFor="f-price"
                hint={maxPrice >= ANY_PRICE ? "Any" : `${formatCurrency(maxPrice)}/unit`}
              >
                <input
                  id="f-price"
                  type="range"
                  min={15}
                  max={ANY_PRICE}
                  step={5}
                  value={maxPrice}
                  onChange={(e) =>
                    setFilter(
                      "maxPrice",
                      Number(e.target.value) >= ANY_PRICE ? "" : e.target.value
                    )
                  }
                  className="w-full accent-leash"
                />
              </Field>

              <button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete("serviceType");
                  next.delete("species");
                  next.delete("maxPrice");
                  setParams(next, { replace: true });
                }}
                className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
              >
                Reset filters
              </button>
            </div>
          </div>
        </aside>

        {/* Results */}
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h1 className="text-xl font-semibold text-ink">
              {city ? `Caretakers near ${city.label}` : "All caretakers"}
            </h1>
            {!loading && (
              <span className="whitespace-nowrap font-mono text-sm text-charcoal/60">
                {results.length}
                {cursor ? "+" : ""} result{results.length === 1 && !cursor ? "" : "s"}
              </span>
            )}
          </div>

          <ResultsGrid
            items={loading || !data ? null : results.map((c) => ({ id: c.profile.id, c }))}
            loading={loading}
            skeleton={<CaretakerCardSkeleton />}
            renderItem={({ c }) => <CaretakerCard caretaker={c} />}
            emptyTitle="No caretakers match those filters"
            emptyDescription="Try widening your price range, clearing the pet-type filter, or searching a nearby city."
            emptyActionLabel="Reset filters"
            emptyActionHref="/search"
          />

          {!loading && cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
