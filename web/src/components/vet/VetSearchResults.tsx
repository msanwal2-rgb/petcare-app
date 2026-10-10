import { useSearchParams } from "react-router";
import { useState } from "react";
import type { ConsultMode, Species, VetSpecialty } from "@/types";
import { searchVets, type VetSearchPage, type VetSearchParams } from "@/api/vets";
import { useAsync } from "@/hooks/useAsync";
import { VetCard } from "@/components/vet/VetCard";
import { CaretakerCardSkeleton } from "@/components/CaretakerCard";
import { Button } from "@/components/ui/Button";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { Field, Select } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { CITIES, cityById } from "@/lib/cities";
import {
  CONSULT_MODE_LABELS,
  CONSULT_MODE_OPTIONS,
  SPECIALTY_LABELS,
  SPECIALTY_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
} from "@/lib/utils";

/** The reference's vet search radius around a city — wider than care, because clinics are sparser. */
const RADIUS_MILES = 60;
const PAGE_SIZE = 12;

/**
 * The reference's `components/vet/VetSearchResults.tsx`. As with the caretaker
 * search, the differences are in the wiring, not the screen:
 *
 *  - **"Near" is a city picker.** The reference matched free text against the
 *    three demo cities; `lib/cities.ts` is the same list, offered honestly.
 *  - **The filters live in the URL**, so `/pet-health` can link straight to
 *    `/vets?emergencyOnly=true` and a search survives a reload.
 *  - **Results are cursor pages**, with "Show more" for the next one.
 */
export function VetSearchResults() {
  const [params, setParams] = useSearchParams();
  const cityId = params.get("city") ?? "";
  const specialty = params.get("specialty") ?? "";
  const species = params.get("species") ?? "";
  const mode = params.get("mode") ?? "";
  const emergencyOnly = params.get("emergencyOnly") === "true";

  const city = cityById(cityId);

  const query: VetSearchParams = {
    lat: city?.lat,
    lng: city?.lng,
    radiusMiles: city ? RADIUS_MILES : undefined,
    specialty: (specialty || undefined) as VetSpecialty | undefined,
    species: (species || undefined) as Species | undefined,
    mode: (mode || undefined) as ConsultMode | undefined,
    emergencyOnly: emergencyOnly || undefined,
    limit: PAGE_SIZE,
  };

  const filterKey = params.toString();
  const [more, setMore] = useState<{ key: string; pages: VetSearchPage[] }>({
    key: "",
    pages: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading } = useAsync(() => searchVets(query), [filterKey]);

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
      const page = await searchVets({ ...query, cursor });
      setMore({ key: filterKey, pages: [...extra, page] });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">Filters</h2>
            <div className="mt-4 space-y-4">
              <Field label="Near" htmlFor="f-location">
                <Select
                  id="f-location"
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
                id="f-specialty"
                label="Specialty"
                anyLabel="Any specialty"
                options={SPECIALTY_OPTIONS}
                optionLabel={(s) => SPECIALTY_LABELS[s]}
                value={specialty}
                onChange={(v) => setFilter("specialty", v)}
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

              <SelectFilter
                id="f-mode"
                label="Consultation"
                anyLabel="Any format"
                options={CONSULT_MODE_OPTIONS}
                optionLabel={(m) => CONSULT_MODE_LABELS[m]}
                value={mode}
                onChange={(v) => setFilter("mode", v)}
              />

              <label className="flex items-center gap-2.5 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={emergencyOnly}
                  onChange={(e) => setFilter("emergencyOnly", e.target.checked ? "true" : "")}
                  className="h-4 w-4 rounded border-mist accent-leash"
                />
                Takes emergencies
              </label>

              <button
                onClick={() => {
                  const next = new URLSearchParams(params);
                  for (const key of ["specialty", "species", "mode", "emergencyOnly"]) {
                    next.delete(key);
                  }
                  setParams(next, { replace: true });
                }}
                className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
              >
                Reset filters
              </button>
            </div>
          </div>
        </aside>

        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h1 className="text-xl font-semibold text-ink">
              {city ? `Vets near ${city.label}` : "All vets"}
            </h1>
            {!loading && (
              <span className="whitespace-nowrap font-mono text-sm text-charcoal/60">
                {results.length}
                {cursor ? "+" : ""} result{results.length === 1 && !cursor ? "" : "s"}
              </span>
            )}
          </div>

          <ResultsGrid
            items={loading || !data ? null : results.map((vet) => ({ id: vet.profile.id, vet }))}
            loading={loading}
            skeleton={<CaretakerCardSkeleton />}
            renderItem={({ vet }) => <VetCard vet={vet} />}
            emptyTitle="No vets match those filters"
            emptyDescription="Try clearing the specialty filter or searching a nearby city. Video consultations aren't limited by distance."
            emptyActionLabel="See all vets"
            emptyActionHref="/vets"
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
