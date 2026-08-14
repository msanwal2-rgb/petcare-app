"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type {
  LifeStage,
  ProductCategory,
  ProductSort,
  Species,
} from "@/types";
import { listBrands, searchProducts } from "@/lib/api/products";
import { getPetsByOwner } from "@/lib/api/pets";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
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

/** Allergens the chosen pet reacts to, matched loosely — see server-side twin. */
function allergenClash(
  productAllergens: string[],
  petAllergies: string[]
): string | undefined {
  const lower = petAllergies.map((a) => a.toLowerCase());
  const hit = productAllergens.find((pa) => {
    const a = pa.toLowerCase();
    return lower.some((pet) => a.includes(pet) || pet.includes(a));
  });
  return hit ? `Contains ${hit.toLowerCase()}` : undefined;
}

export function StoreCatalog() {
  const params = useSearchParams();
  const { currentUser } = useSession();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [category, setCategory] = useState(params.get("category") ?? "");
  const [species, setSpecies] = useState(params.get("species") ?? "");
  const [lifeStage, setLifeStage] = useState("");
  const [brand, setBrand] = useState("");
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE_CENTS);
  const [sort, setSort] = useState<ProductSort>("featured");
  const [page, setPage] = useState(0);
  const [petId, setPetId] = useState(params.get("petId") ?? "");

  const { data: brands } = useAsync(() => listBrands(), []);
  const { data: pets } = useAsync(
    () => (currentUser ? getPetsByOwner(currentUser.id) : Promise.resolve([])),
    [currentUser?.id]
  );

  const pet = (pets ?? []).find((p) => p.id === petId);

  const { data, loading } = useAsync(
    () =>
      searchProducts({
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
        offset: page * PAGE_SIZE,
      }),
    [q, category, species, lifeStage, brand, maxPrice, sort, page, pet?.species]
  );

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  function reset() {
    setQ("");
    setCategory("");
    setSpecies("");
    setLifeStage("");
    setBrand("");
    setMaxPrice(MAX_PRICE_CENTS);
    setPage(0);
  }

  /** Any filter change should return to the first page of results. */
  function onFilter<T>(setter: (v: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(0);
    };
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      {(pets ?? []).length > 0 && (
        <PetShoppingBar
          pets={pets ?? []}
          selectedId={petId}
          onSelect={onFilter(setPetId)}
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
                  onChange={(e) => onFilter(setQ)(e.target.value)}
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
                onChange={onFilter(setCategory)}
              />

              {!pet && (
                <SelectFilter
                  id="p-species"
                  label="Pet type"
                  anyLabel="Any pet"
                  options={SPECIES_OPTIONS}
                  optionLabel={(s) => SPECIES_LABELS[s]}
                  value={species}
                  onChange={onFilter(setSpecies)}
                />
              )}

              <SelectFilter
                id="p-stage"
                label="Life stage"
                anyLabel="Any age"
                options={STAGE_OPTIONS}
                optionLabel={(s) => LIFE_STAGE_LABELS[s]}
                value={lifeStage}
                onChange={onFilter(setLifeStage)}
              />

              <SelectFilter
                id="p-brand"
                label="Brand"
                anyLabel="All brands"
                options={brands ?? []}
                optionLabel={(b) => b}
                value={brand}
                onChange={onFilter(setBrand)}
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
                  onChange={(e) => onFilter(setMaxPrice)(Number(e.target.value))}
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
                <span className="font-mono text-sm text-charcoal/60">
                  {total} item{total === 1 ? "" : "s"}
                </span>
              )}
              <Select
                value={sort}
                onChange={(e) => onFilter(setSort)(e.target.value as ProductSort)}
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
            items={data?.items ?? null}
            loading={loading}
            className={PRODUCT_GRID}
            skeletonCount={8}
            skeleton={<Skeleton className="aspect-[3/4] w-full rounded-[12px]" />}
            renderItem={(p) => (
              <ProductCard
                product={p}
                allergenWarning={
                  pet ? allergenClash(p.allergens, pet.allergies) : undefined
                }
              />
            )}
            emptyTitle="Nothing matches those filters"
            emptyDescription="Try widening the price range or clearing the category filter."
            emptyActionLabel="Reset filters"
            emptyActionHref="/store"
          />

          {items.length > 0 && (
            <>
              {pages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="font-mono text-sm text-charcoal/60">
                    {page + 1} / {pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}

          <p className="mt-10 rounded-2xl border border-mist bg-white px-5 py-4 text-sm text-charcoal/70">
            Looking for a therapeutic diet? Prescription items unlock
            automatically once your vet adds the prescription to your pet&apos;s
            health record.{" "}
            <Link href="/vets" className="font-medium text-ink underline">
              Book a vet
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
