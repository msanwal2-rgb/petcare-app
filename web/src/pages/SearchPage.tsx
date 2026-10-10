import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { ServiceType, Species } from "@/types";
import {
  searchCaretakers,
  type CaretakerSearchParams,
  type CaretakerWithUser,
} from "@/api/caretakers";
import { CaretakerCard, CaretakerCardSkeleton } from "@/components/CaretakerCard";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { CITIES, CITY_RADIUS_MILES, cityById } from "@/lib/cities";
import { SERVICE_LABELS, SPECIES_LABELS } from "@/lib/utils";

/**
 * Caretaker search.
 *
 * ── Why "Show more" rather than page numbers ──
 *
 * The API is cursor-paginated: a page hands back a token pointing at the last
 * row it returned, and there is no page count because counting the whole result
 * set would double the cost of every search. That maps to appending, not to
 * numbered pages — which is also the right interaction for a result list people
 * scan rather than navigate.
 *
 * The filters live in the URL so a search can be shared, bookmarked and
 * reloaded, and so the landing page's search bar can hand off to this one. The
 * cursor deliberately does **not**: it is a position in a result set that shifts
 * as reputations move, and a bookmarked page 3 would be a lie.
 *
 * ── The city is the only way in to distance search ──
 *
 * `?city=austin` resolves to coordinates through `lib/cities.ts` and is sent as
 * `lat`/`lng`/`radiusMiles`. That switches the server's ordering from
 * best-rated to nearest-first and puts a distance on every card — the haversine
 * search M4 built in SQL, reachable from the UI for the first time.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<CaretakerWithUser[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cityId = params.get("city") ?? "";
  const serviceType = (params.get("serviceType") ?? "") as ServiceType | "";
  const species = (params.get("species") ?? "") as Species | "";
  const startDate = params.get("startDate") ?? "";
  const maxPrice = params.get("maxPrice") ?? "";

  // An unknown `?city=` is ignored rather than refused — a stale link should
  // still show results, just not narrowed to a place that no longer exists.
  const city = cityById(cityId);

  const query: CaretakerSearchParams = {
    lat: city?.lat,
    lng: city?.lng,
    radiusMiles: city ? CITY_RADIUS_MILES : undefined,
    serviceType: serviceType || undefined,
    species: species || undefined,
    startDate: startDate || undefined,
    maxPrice: maxPrice ? Number(maxPrice) : undefined,
    limit: 12,
  };

  // Re-runs whenever a filter changes, and resets the list rather than
  // appending — a new filter is a new result set, not more of the old one.
  const runSearch = useCallback(() => {
    setItems(null);
    setError(null);

    searchCaretakers(query)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId, serviceType, species, startDate, maxPrice]);

  useEffect(runSearch, [runSearch]);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await searchCaretakers({ ...query, cursor });
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
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Find a caretaker</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        {city
          ? `Walking, sitting, boarding and daycare within ${CITY_RADIUS_MILES} miles of ${city.label}, nearest first.`
          : "Walking, sitting, boarding and daycare, best rated first."}
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="City" htmlFor="city">
          <Select
            id="city"
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

        <Field label="Service" htmlFor="serviceType">
          <Select
            id="serviceType"
            value={serviceType}
            onChange={(e) => setFilter("serviceType", e.target.value)}
          >
            <option value="">Any service</option>
            {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((s) => (
              <option key={s} value={s}>
                {SERVICE_LABELS[s]}
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

        <Field label="Available from" htmlFor="startDate">
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setFilter("startDate", e.target.value)}
          />
        </Field>

        <Field label="Budget" hint="per hour or day" htmlFor="maxPrice">
          <Select
            id="maxPrice"
            value={maxPrice}
            onChange={(e) => setFilter("maxPrice", e.target.value)}
          >
            <option value="">Any price</option>
            <option value="25">Up to $25</option>
            <option value="40">Up to $40</option>
            <option value="60">Up to $60</option>
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
        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <CaretakerCardSkeleton />
          <CaretakerCardSkeleton />
          <CaretakerCardSkeleton />
        </div>
      )}

      {items?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center text-sm text-charcoal/70">
          Nobody matches those filters. Try widening them.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((caretaker) => (
              <li key={caretaker.profile.id}>
                <CaretakerCard caretaker={caretaker} />
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
