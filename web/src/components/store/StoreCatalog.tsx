import { Link, useSearchParams } from "react-router";
import { useState } from "react";
import type {
  LifeStage,
  ProductCategory,
  ProductPage,
  ProductSearchParams,
  ProductSort,
  Species,
} from "@/types";
import { listBrands, searchProducts } from "@/api/catalog";
import { listMyPets } from "@/api/pets";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { ProductCard } from "./ProductCard";
import { PetShoppingBar } from "./PetShoppingBar";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { ResultsGrid } from "@/components/ui/ResultsGrid";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CATEGORY_LABELS,
  CATEGORY_OPTIONS,
  LIFE_STAGE_LABELS,
  LIFE_STAGE_OPTIONS,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
  formatCents,
} from "@/lib/utils";

/** "all" is a property of a product, not something a shopper filters by. */
const STAGE_OPTIONS = LIFE_STAGE_OPTIONS.filter((s) => s !== "all");
const SORTS: { value: ProductSort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating", label: "Best rated" },
  { value: "newest", label: "Newest" },
];

const PRODUCT_GRID = "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const PAGE_SIZE = 12;
const MAX_PRICE_CENTS = 12000;

/**
 * The reference's `components/store/StoreCatalog.tsx`. Three differences:
 *
 *  - **No allergen flags on the cards.** The reference matched a product's
 *    allergens against the pet's in the browser — one of the three matchers
 *    REQUIREMENTS.md §12 lists, where S18 wants one, on the server. The
 *    product page and the cart both show the server's finding instead.
 *  - **"Show more" rather than numbered pages.** The catalogue is keyset-paged
 *    like every list in this API, and never counts the whole result set.
 *  - **The filters live in the URL**, so `?petId=` from "Shop everything for
 *    Bruno" and a shared link both land on the same shelf.
 */
export function StoreCatalog() {
  const [params, setParams] = useSearchParams();
  const { currentUser } = useSession();

  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const species = params.get("species") ?? "";
  const lifeStage = params.get("lifeStage") ?? "";
  const brand = params.get("brand") ?? "";
  const maxPrice = Number(params.get("maxPriceCents") ?? MAX_PRICE_CENTS) || MAX_PRICE_CENTS;
  const sort = (params.get("sort") ?? "featured") as ProductSort;
  const petId = params.get("petId") ?? "";

  const { data: brands } = useAsync(() => listBrands(), []);
  const { data: pets } = useAsync(
    () => (currentUser ? listMyPets() : Promise.resolve([])),
    [currentUser?.id]
  );

  const pet = (pets ?? []).find((p) => p.id === petId);

  const query: ProductSearchParams = {
    q: q.trim() || undefined,
    category: (category || undefined) as ProductCategory | undefined,
    // Shopping "for Bruno" implies his species without asking twice.
    // `||` not `??`: the filter's "no selection" value is "", not null.
    species: (pet?.species || species || undefined) as Species | undefined,
    lifeStage: (lifeStage || undefined) as LifeStage | undefined,
    brand: brand || undefined,
    maxPriceCents: maxPrice < MAX_PRICE_CENTS ? maxPrice : undefined,
    sort,
    limit: PAGE_SIZE,
  };
  // The pet's species is part of the query, so it is part of the key.
  const filterKey = `${params.toString()}|${pet?.species ?? ""}`;

  const [more, setMore] = useState<{ key: string; pages: ProductPage[] }>({
    key: "",
    pages: [],
  });
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading } = useAsync(() => searchProducts(query), [filterKey]);

  const extra = more.key === filterKey ? more.pages : [];
  const pages = data ? [data, ...extra] : [];
  const items = pages.flatMap((p) => p.items);
  const cursor = pages.length > 0 ? pages[pages.length - 1].nextCursor : null;

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  function reset() {
    const next = new URLSearchParams();
    if (petId) next.set("petId", petId);
    setParams(next, { replace: true });
  }

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await searchProducts({ ...query, cursor });
      setMore({ key: filterKey, pages: [...extra, page] });
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      {(pets ?? []).length > 0 && (
        <PetShoppingBar
          pets={pets ?? []}
          selectedId={petId}
          onSelect={(id) => setFilter("petId", id)}
          className="mb-6"
        />
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-mist bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">Filters</h2>
            <div className="mt-4 space-y-4">
              <Field label="Search" htmlFor="p-q">
                <Input
                  id="p-q"
                  value={q}
                  onChange={(e) => setFilter("q", e.target.value)}
                  placeholder="Salmon, dental, VetLine…"
                />
              </Field>

              <SelectFilter
                id="p-cat"
                label="Category"
                anyLabel="All categories"
                options={CATEGORY_OPTIONS}
                optionLabel={(c) => CATEGORY_LABELS[c]}
                value={category}
                onChange={(v) => setFilter("category", v)}
              />

              {!pet && (
                <SelectFilter
                  id="p-species"
                  label="Pet type"
                  anyLabel="Any pet"
                  options={SPECIES_OPTIONS}
                  optionLabel={(s) => SPECIES_LABELS[s]}
                  value={species}
                  onChange={(v) => setFilter("species", v)}
                />
              )}

              <SelectFilter
                id="p-stage"
                label="Life stage"
                anyLabel="Any age"
                options={STAGE_OPTIONS}
                optionLabel={(s) => LIFE_STAGE_LABELS[s]}
                value={lifeStage}
                onChange={(v) => setFilter("lifeStage", v)}
              />

              <SelectFilter
                id="p-brand"
                label="Brand"
                anyLabel="All brands"
                options={brands ?? []}
                optionLabel={(b) => b}
                value={brand}
                onChange={(v) => setFilter("brand", v)}
              />

              <Field
                label="Max price"
                htmlFor="p-price"
                hint={
                  maxPrice >= MAX_PRICE_CENTS ? "Any" : formatCents(maxPrice)
                }
              >
                <input
                  id="p-price"
                  type="range"
                  min={500}
                  max={MAX_PRICE_CENTS}
                  step={500}
                  value={maxPrice}
                  onChange={(e) =>
                    setFilter(
                      "maxPriceCents",
                      Number(e.target.value) >= MAX_PRICE_CENTS ? "" : e.target.value
                    )
                  }
                  className="w-full accent-leash"
                />
              </Field>

              <button
                onClick={reset}
                className="text-xs text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
              >
                Reset filters
              </button>
            </div>
          </div>
        </aside>

        <section>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="text-xl font-semibold text-ink">
              {pet ? `Food & supplies for ${pet.name}` : "Pet food & supplies"}
            </h1>
            <div className="flex items-center gap-3">
              {!loading && (
                <span className="whitespace-nowrap font-mono text-sm text-charcoal/60">
                  {items.length}
                  {cursor ? "+" : ""} item{items.length === 1 && !cursor ? "" : "s"}
                </span>
              )}
              <Select
                value={sort}
                onChange={(e) => setFilter("sort", e.target.value === "featured" ? "" : e.target.value)}
                aria-label="Sort products"
                className="w-auto py-1.5 text-sm"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <ResultsGrid
            items={loading || !data ? null : items}
            loading={loading}
            className={PRODUCT_GRID}
            skeletonCount={8}
            skeleton={<Skeleton className="aspect-[3/4] w-full rounded-[12px]" />}
            renderItem={(p) => <ProductCard product={p} />}
            emptyTitle="Nothing matches those filters"
            emptyDescription="Try widening the price range or clearing the category filter."
            emptyActionLabel="Reset filters"
            emptyActionHref="/store"
          />

          {!loading && cursor && (
            <div className="mt-8 flex items-center justify-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}

          <p className="mt-10 rounded-2xl border border-mist bg-white px-5 py-4 text-sm text-charcoal/70">
            Looking for a therapeutic diet? Prescription items unlock
            automatically once your vet adds the prescription to your pet&apos;s
            health record.{" "}
            <Link to="/vets" className="font-medium text-ink underline">
              Book a vet
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
