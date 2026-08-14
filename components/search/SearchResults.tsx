"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { ServiceType, Species } from "@/types";
import { searchCaretakers } from "@/lib/api/caretakers";
import { useAsync } from "@/lib/hooks/useAsync";
import { CaretakerCard } from "@/components/CaretakerCard";
import { CaretakerCardSkeleton } from "@/components/CaretakerCardSkeleton";
import { SearchBar } from "@/components/SearchBar";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { Field } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import {
  SERVICE_LABELS,
  SERVICE_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
  formatCurrency,
} from "@/lib/utils";
import { coordsFor } from "@/lib/geo";

export function SearchResults() {
  const params = useSearchParams();
  const location = params.get("location") ?? "";
  const startDate = params.get("startDate") ?? "";
  const endDate = params.get("endDate") ?? "";

  const [service, setService] = useState(params.get("service") ?? "");
  const [species, setSpecies] = useState("");
  const [maxPrice, setMaxPrice] = useState(100);

  const origin = useMemo(() => coordsFor(location), [location]);

  const { data, loading } = useAsync(
    () =>
      searchCaretakers({
        location: location || undefined,
        lat: origin?.lat,
        lng: origin?.lng,
        radiusMiles: origin ? 40 : undefined,
        serviceType: (service || undefined) as ServiceType | undefined,
        species: (species || undefined) as Species | undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        maxPrice: maxPrice < 100 ? maxPrice : undefined,
      }),
    [location, origin, service, species, startDate, maxPrice, endDate]
  );

  const results = data ?? [];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="mb-6">
        <SearchBar
          variant="inline"
          initial={{ location, service, startDate, endDate }}
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
                onChange={setService}
              />

              <SelectFilter
                id="f-species"
                label="Pet type"
                anyLabel="Any pet"
                options={SPECIES_OPTIONS}
                optionLabel={(s) => SPECIES_LABELS[s]}
                value={species}
                onChange={setSpecies}
              />

              <Field
                label="Max price"
                htmlFor="f-price"
                hint={maxPrice >= 100 ? "Any" : `${formatCurrency(maxPrice)}/unit`}
              >
                <input
                  id="f-price"
                  type="range"
                  min={15}
                  max={100}
                  step={5}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="w-full accent-leash"
                />
              </Field>

              <button
                onClick={() => {
                  setService("");
                  setSpecies("");
                  setMaxPrice(100);
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
              {location ? `Caretakers near ${location}` : "All caretakers"}
            </h1>
            {!loading && (
              <span className="font-mono text-sm text-charcoal/60">
                {results.length} result{results.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          <ResultsGrid
            items={data}
            loading={loading}
            skeleton={<CaretakerCardSkeleton />}
            renderItem={(caretaker) => <CaretakerCard caretaker={caretaker} />}
            emptyTitle="No caretakers match those filters"
            emptyDescription="Try widening your price range, clearing the pet-type filter, or searching a nearby city."
            emptyActionLabel="Reset filters"
            emptyActionHref="/search"
          />
        </section>
      </div>
    </div>
  );
}
