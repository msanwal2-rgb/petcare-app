import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type {
  LifeStage,
  Product,
  ProductCategory,
  ProductSearchParams,
  ProductSort,
  Species,
} from "@/types";
import { listBrands, searchProducts } from "@/api/catalog";
import { ProductCard } from "@/components/store/ProductCard";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  LIFE_STAGE_LABELS,
  LIFE_STAGE_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
} from "@/lib/utils";

const SORT_LABELS: Record<ProductSort, string> = {
  featured: "Featured",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  rating: "Best rated",
  newest: "Newest",
};

/**
 * The store's shelves.
 *
 * Search, filters and sort live in the URL so a shelf can be shared and
 * reloaded; the cursor does not, because it is a position in a result set that
 * moves as stock and ratings change. "Show more" appends, for the same reason
 * as caretaker and vet search — the API is keyset-paginated and has no page
 * count to number against.
 *
 * Prescription diets appear here like everything else, badged "Vet Rx". Hiding
 * them would make "your vet can prescribe this" undiscoverable; the gate is at
 * the quote, which is where it can actually be enforced.
 */
export default function StorePage() {
  const [params, setParams] = useSearchParams();

  const [items, setItems] = useState<Product[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<string[]>([]);

  const q = params.get("q") ?? "";
  const category = (params.get("category") ?? "") as ProductCategory | "";
  const species = (params.get("species") ?? "") as Species | "";
  const lifeStage = (params.get("lifeStage") ?? "") as LifeStage | "";
  const brand = params.get("brand") ?? "";
  const sort = (params.get("sort") ?? "featured") as ProductSort;

  // The text box is local until submitted — refetching on every keystroke
  // would be a request per letter for a result nobody has finished typing.
  const [draft, setDraft] = useState(q);

  const query: ProductSearchParams = {
    q: q || undefined,
    category: category || undefined,
    species: species || undefined,
    lifeStage: lifeStage || undefined,
    brand: brand || undefined,
    sort,
    limit: 12,
  };

  useEffect(() => {
    listBrands().then(setBrands).catch(() => setBrands([]));
  }, []);

  const runSearch = useCallback(() => {
    setItems(null);
    setError(null);
    searchProducts(query)
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, species, lifeStage, brand, sort]);

  useEffect(runSearch, [runSearch]);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await searchProducts({ ...query, cursor });
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
      <h1 className="text-2xl font-semibold text-ink">The store</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Food, treats, supplements, and the therapeutic diets your vet prescribes.
      </p>

      <form
        className="mt-8 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter("q", draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search by name, brand or ingredient"
          aria-label="Search the store"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Category" htmlFor="category">
          <Select id="category" value={category} onChange={(e) => setFilter("category", e.target.value)}>
            <option value="">Everything</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Pet" htmlFor="species">
          <Select id="species" value={species} onChange={(e) => setFilter("species", e.target.value)}>
            <option value="">Any pet</option>
            {SPECIES_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SPECIES_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Life stage" htmlFor="lifeStage">
          <Select id="lifeStage" value={lifeStage} onChange={(e) => setFilter("lifeStage", e.target.value)}>
            <option value="">Any age</option>
            {LIFE_STAGE_OPTIONS.filter((s) => s !== "all").map((s) => (
              <option key={s} value={s}>
                {LIFE_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Brand" htmlFor="brand">
          <Select id="brand" value={brand} onChange={(e) => setFilter("brand", e.target.value)}>
            <option value="">Any brand</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sort" htmlFor="sort">
          <Select
            id="sort"
            value={sort}
            onChange={(e) => setFilter("sort", e.target.value === "featured" ? "" : e.target.value)}
          >
            {(Object.keys(SORT_LABELS) as ProductSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s]}
              </option>
            ))}
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
        <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] rounded-[12px]" />
          ))}
        </div>
      )}

      {items?.length === 0 && (
        <p className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center text-sm text-charcoal/70">
          Nothing on the shelves matches that. Try widening the filters.
        </p>
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
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
