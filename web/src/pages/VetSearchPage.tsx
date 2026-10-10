import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ConsultMode, Species, VetSpecialty } from "@/types";
import { searchVets, type VetSearchParams, type VetWithUser } from "@/api/vets";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  SPECIES_LABELS,
  formatCurrency,
} from "@/lib/utils";

/**
 * Vet search.
 *
 * The caretaker search's twin, and deliberately so — the same "Show more"
 * rather than page numbers, for the same reason: the API is cursor-paginated
 * and there is no page count, because counting the whole result set would
 * double the cost of every search.
 *
 * The filters live in the URL so a search can be shared and reloaded. The
 * cursor deliberately does not: it is a position in a result set that shifts as
 * ratings move, and a bookmarked page 3 would be a lie.
 */
export default function VetSearchPage() {
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<VetWithUser[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const specialty = (params.get("specialty") ?? "") as VetSpecialty | "";
  const species = (params.get("species") ?? "") as Species | "";
  const mode = (params.get("mode") ?? "") as ConsultMode | "";
  const emergencyOnly = params.get("emergencyOnly") === "1";

  const query: VetSearchParams = {
    specialty: specialty || undefined,
    species: species || undefined,
    mode: mode || undefined,
    emergencyOnly: emergencyOnly || undefined,
    limit: 12,
  };

  // Re-runs whenever a filter changes, and resets the list rather than
  // appending — a new filter is a new result set, not more of the old one.
  const runSearch = useCallback(() => {
    setItems(null);
    setError(null);

    searchVets(query)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specialty, species, mode, emergencyOnly]);

  useEffect(runSearch, [runSearch]);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await searchVets({ ...query, cursor });
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load more");
    } finally {
      setLoadingMore(false);
    }
  }

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Find a vet</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Licensed clinics, in person or by video. Visit notes and prescriptions go
        straight into your pet's health record.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Specialty" htmlFor="specialty">
          <Select
            id="specialty"
            value={specialty}
            onChange={(e) => setFilter("specialty", e.target.value)}
          >
            <option value="">Any specialty</option>
            {(Object.keys(SPECIALTY_LABELS) as VetSpecialty[]).map((s) => (
              <option key={s} value={s}>
                {SPECIALTY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Pet" htmlFor="species">
          <Select
            id="species"
            value={species}
            onChange={(e) => setFilter("species", e.target.value)}
          >
            <option value="">Any pet</option>
            {(Object.keys(SPECIES_LABELS) as Species[]).map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Consultation" htmlFor="mode">
          <Select
            id="mode"
            value={mode}
            onChange={(e) => setFilter("mode", e.target.value)}
          >
            <option value="">Any kind</option>
            {(Object.keys(CONSULT_MODE_LABELS) as ConsultMode[]).map((m) => (
              <option key={m} value={m}>
                {CONSULT_MODE_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Urgency" htmlFor="emergencyOnly">
          <Select
            id="emergencyOnly"
            value={emergencyOnly ? "1" : ""}
            onChange={(e) => setFilter("emergencyOnly", e.target.value)}
          >
            <option value="">Any clinic</option>
            <option value="1">Emergency cover only</option>
          </Select>
        </Field>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-8 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {error}
        </p>
      )}

      {items === null && !error && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )}

      {items?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center text-sm text-charcoal/70">
          No clinic matches those filters. Try widening them.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {items.map((vet) => (
              <li key={vet.profile.id}>
                <VetCard vet={vet} />
              </li>
            ))}
          </ul>

          {cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function VetCard({ vet }: { vet: VetWithUser }) {
  const { profile, user, distanceMiles } = vet;

  return (
    <Link
      to={`/vet/${profile.id}`}
      className="flex h-full gap-4 rounded-2xl border border-mist bg-white p-4 transition-colors hover:border-ink"
    >
      <img
        src={user.avatarUrl}
        alt=""
        width={64}
        height={64}
        className="size-16 shrink-0 rounded-full bg-mist object-cover"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-medium text-ink">{user.name}</p>
          <span className="shrink-0 text-sm text-charcoal/70">
            {profile.rating.toFixed(1)} ★
          </span>
        </div>

        <p className="mt-0.5 truncate text-sm text-charcoal/60">
          {profile.clinicName}
        </p>

        <p className="mt-0.5 truncate text-sm text-charcoal/60">
          {profile.clinic.city}, {profile.clinic.state}
          {distanceMiles !== null && ` · ${distanceMiles.toFixed(1)} mi`}
        </p>

        <p className="mt-1.5 truncate text-sm text-charcoal/70">
          {profile.specialties.map((s) => SPECIALTY_LABELS[s]).join(" · ")}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {formatCurrency(profile.consultFee)}
          </span>
          {profile.emergencyAvailable && (
            <span className="rounded-full bg-leash/10 px-2 py-0.5 text-xs font-medium text-leash">
              Emergency
            </span>
          )}
          {/* Set by staff, never by the clinic — which is the only reason it
              means anything to the person reading it. */}
          {profile.verificationStatus === "verified" && (
            <span className="rounded-full bg-mist/60 px-2 py-0.5 text-xs font-medium text-ink">
              Licence verified
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
