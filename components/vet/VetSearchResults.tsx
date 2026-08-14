"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { ConsultMode, Species, VetSpecialty } from "@/types";
import { searchVets } from "@/lib/api/vets";
import { useAsync } from "@/lib/hooks/useAsync";
import { VetCard } from "@/components/vet/VetCard";
import { CaretakerCardSkeleton } from "@/components/CaretakerCardSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { RevealItem } from "@/components/ui/Reveal";
import { Field, Input, Select } from "@/components/ui/Field";
import { SearchIcon } from "@/components/ui/icons";
import { coordsFor } from "@/lib/geo";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  SPECIES_LABELS,
} from "@/lib/utils";

const SPECIALTIES: VetSpecialty[] = [
  "general",
  "dermatology",
  "dentistry",
  "surgery",
  "emergency",
  "nutrition",
  "behavior",
  "exotics",
];
const MODES: ConsultMode[] = ["in_clinic", "video", "home_visit"];
const SPECIES: Species[] = ["dog", "cat", "other"];

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

              <Field label="Specialty" htmlFor="f-specialty">
                <Select
                  id="f-specialty"
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                >
                  <option value="">Any specialty</option>
                  {SPECIALTIES.map((s) => (
                    <option key={s} value={s}>
                      {SPECIALTY_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Pet type" htmlFor="f-species">
                <Select
                  id="f-species"
                  value={species}
                  onChange={(e) => setSpecies(e.target.value)}
                >
                  <option value="">Any pet</option>
                  {SPECIES.map((s) => (
                    <option key={s} value={s}>
                      {SPECIES_LABELS[s]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Consultation" htmlFor="f-mode">
                <Select
                  id="f-mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="">Any format</option>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {CONSULT_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </Field>

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

          {loading || data === null ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <CaretakerCardSkeleton key={i} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              icon={<SearchIcon width={40} height={40} />}
              title="No vets match those filters"
              description="Try clearing the specialty filter or searching a nearby city. Video consultations aren't limited by distance."
              actionLabel="See all vets"
              actionHref="/vets"
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((v) => (
                <RevealItem key={v.id}>
                  <VetCard vet={v} />
                </RevealItem>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
