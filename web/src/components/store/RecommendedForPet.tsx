import { Link } from "react-router";
import type { Pet } from "@/types";
import { getPetRecommendations } from "@/api/pets";
import { useAsync } from "@/hooks/useAsync";
import { ProductCard } from "./ProductCard";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * "Picked for Bruno" — the store reading the pet record rather than guessing.
 * Species, life stage from date of birth, and everything containing a known
 * allergen filtered out server-side.
 */
export function RecommendedForPet({
  pet,
  limit = 4,
  className,
}: {
  pet: Pet;
  limit?: number;
  className?: string;
}) {
  const { data, loading } = useAsync(
    () => getPetRecommendations(pet.id),
    [pet.id]
  );

  if (loading) {
    return (
      <div className={className}>
        <Skeleton className="h-6 w-48" />
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: limit }).map((_, i) => (
            <Skeleton key={i} className="aspect-[3/4] w-full rounded-[12px]" />
          ))}
        </div>
      </div>
    );
  }

  const items = (data ?? []).slice(0, limit);
  if (items.length === 0) return null;

  return (
    <section className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Picked for {pet.name}</h2>
        <Link
          to={`/store?petId=${pet.id}`}
          className="text-sm text-charcoal/65 underline-offset-2 hover:text-ink hover:underline"
        >
          Shop everything for {pet.name} →
        </Link>
      </div>
      {pet.allergies.length > 0 && (
        <p className="mb-3 text-xs text-charcoal/60">
          Excludes anything containing {pet.allergies.join(" or ").toLowerCase()}.
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
