"use client";

import Image from "next/image";
import type { Pet } from "@/types";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { cn } from "@/lib/utils";

/**
 * "Shopping for…" selector.
 *
 * Picking a pet narrows the catalog to their species, flags anything containing
 * an ingredient they react to, and is what unlocks prescription items they hold
 * a current prescription for. It's the seam between the health record and the
 * store — without it the store is just a generic shop that happens to live here.
 */
export function PetShoppingBar({
  pets,
  selectedId,
  onSelect,
  className,
}: {
  pets: Pet[];
  selectedId: string;
  onSelect: (petId: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-mist bg-white px-4 py-3",
        className
      )}
    >
      <span className="text-sm font-medium text-ink">Shopping for</span>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSelect("")}
          aria-pressed={selectedId === ""}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            selectedId === ""
              ? "border-ink bg-ink text-white"
              : "border-mist bg-white text-charcoal hover:border-ink/40"
          )}
        >
          Everyone
        </button>

        {pets.map((pet) => {
          const on = selectedId === pet.id;
          return (
            <button
              key={pet.id}
              type="button"
              onClick={() => onSelect(pet.id)}
              aria-pressed={on}
              className={cn(
                "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm transition-colors",
                on
                  ? "border-ink bg-ink text-white"
                  : "border-mist bg-white text-charcoal hover:border-ink/40"
              )}
            >
              <span className="relative h-6 w-6 overflow-hidden rounded-full">
                <Image
                  src={pet.photoUrl}
                  alt=""
                  fill
                  sizes="24px"
                  placeholder="blur"
                  blurDataURL={BLUR_DATA_URL}
                  className="object-cover"
                />
              </span>
              {pet.name}
            </button>
          );
        })}
      </div>

      {selectedId && (
        <span className="text-xs text-charcoal/55">
          Filtered to their species, with allergens flagged.
        </span>
      )}
    </div>
  );
}
