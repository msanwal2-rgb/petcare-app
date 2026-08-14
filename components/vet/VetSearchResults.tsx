"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { ConsultMode, Species, VetSpecialty } from "@/types";
import { searchVets } from "@/lib/api/vets";
import { useAsync } from "@/lib/hooks/useAsync";
import { VetCard } from "@/components/vet/VetCard";
import { CaretakerCardSkeleton } from "@/components/CaretakerCardSkeleton";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { Field, Input } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { coordsFor } from "@/lib/geo";
import {
  CONSULT_MODE_LABELS,
  CONSULT_MODE_OPTIONS,
  SPECIALTY_LABELS,
  SPECIALTY_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
} from "@/lib/utils";

export function VetSearchResults() {
  const params = useSearchParams();
  const [location, setLocation] = useState(params.get("location") ?? "");
  const [specialty, setSpecialty] = useState(params.get("specialty") ?? "");
  const [species, setSpecies] = useState(params.get("species") ?? "");
  const [mode, setMode] = useState(params.get("mode") ?? "");
  // /pet-health links straight here for the emergency list.
  const [emergencyOnly, setEmergencyOnly] = useState(
    params.get("emergencyOnly") === "true"
  );

  const origin = useMemo(() => coordsFor(location), [location]);

  const { data, loading } = useAsync(
    () =>
      searchVets({
        lat: origin?.lat,
        lng: origin?.lng,
        radiusMiles: origin ? 60 : undefined,
        specialty: (specialty || undefined) as VetSpecialty | undefined,
        species: (species || undefined) as Species | undefined,
        mode: (mode || undefined) as ConsultMode | undefined,
        emergencyOnly: emergencyOnly || undefined,
      }),
    [origin, specialty, species, mode, emergencyOnly]
  );

  const results = data ?? [];

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">Filters</h2>
            <div className="mt-4 space-y-4">
              <Field label="Near" htmlFor="f-location">
                <Input
                  id="f-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Austin, TX"
                />
              </Field>

              <SelectFilter
                id="f-specialty"
                label="Specialty"
                anyLabel="Any specialty"
                options={SPECIALTY_OPTIONS}
                optionLabel={(s) => SPECIALTY_LABELS[s]}
                value={specialty}
                onChange={setSpecialty}
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

              <SelectFilter
                id="f-mode"
                label="Consultation"
                anyLabel="Any format"
                options={CONSULT_MODE_OPTIONS}
                optionLabel={(m) => CONSULT_MODE_LABELS[m]}
                value={mode}
                onChange={setMode}
              />

              <label className="flex items-center gap-2.5 text-sm text-charcoal">
                <input
                  type="checkbox"
                  checked={emergencyOnly}
                  onChange={(e) => setEmergencyOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-mist accent-leash"
                />
                Takes emergencies
              </label>

              <button
                onClick={() => {
                  setSpecialty("");
                  setSpecies("");
                  setMode("");
                  setEmergencyOnly(false);
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
              {location ? `Vets near ${location}` : "All vets"}
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
            renderItem={(vet) => <VetCard vet={vet} />}
            emptyTitle="No vets match those filters"
            emptyDescription="Try clearing the specialty filter or searching a nearby city. Video consultations aren't limited by distance."
            emptyActionLabel="See all vets"
            emptyActionHref="/vets"
          />
        </section>
      </div>
    </div>
  );
}
