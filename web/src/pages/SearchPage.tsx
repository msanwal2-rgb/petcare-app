import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ServiceType, Species } from "@/types";
import {
  searchCaretakers,
  type CaretakerSearchParams,
  type CaretakerWithUser,
} from "@/api/caretakers";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { SERVICE_LABELS, SPECIES_LABELS, formatCurrency } from "@/lib/utils";

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
 * reloaded. The cursor deliberately does **not**: it is a position in a result
 * set that shifts as reputations move, and a bookmarked page 3 would be a lie.
 */
export default function SearchPage() {
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<CaretakerWithUser[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const serviceType = (params.get("serviceType") ?? "") as ServiceType | "";
  const species = (params.get("species") ?? "") as Species | "";
  const maxPrice = params.get("maxPrice") ?? "";

  const query: CaretakerSearchParams = {
    serviceType: serviceType || undefined,
    species: species || undefined,
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
  }, [serviceType, species, maxPrice]);

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
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Find a caretaker</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Walking, sitting, boarding and daycare, from people near you.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
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
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-36 rounded-2xl" />
        </div>
      )}

      {items?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center text-sm text-charcoal/70">
          Nobody matches those filters. Try widening them.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
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

function CaretakerCard({ caretaker }: { caretaker: CaretakerWithUser }) {
  const { profile, user, priceRange, distanceMiles } = caretaker;

  return (
    <Link
      to={`/caretaker/${profile.id}`}
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
          {user.address.city}, {user.address.state}
          {distanceMiles !== null && ` · ${distanceMiles.toFixed(1)} mi`}
        </p>

        <p className="mt-1.5 truncate text-sm text-charcoal/70">
          {profile.servicesOffered.map((s) => SERVICE_LABELS[s]).join(" · ")}
        </p>

        <p className="mt-1.5 text-sm font-medium text-ink">
          {priceRange.min === priceRange.max
            ? formatCurrency(priceRange.min)
            : `${formatCurrency(priceRange.min)}–${formatCurrency(priceRange.max)}`}
        </p>
      </div>
    </Link>
  );
}
