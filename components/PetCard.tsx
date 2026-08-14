"use client";

import Image from "next/image";
import Link from "next/link";
import type { Pet } from "@/types";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { SPECIES_LABELS, cn, petAge } from "@/lib/utils";
import { CheckIcon } from "./ui/icons";

function Meta({ pet }: { pet: Pet }) {
  return (
    <>
      <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-lg">
        <Image
          src={pet.photoUrl}
          alt={pet.name}
          fill
          sizes="80px"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold text-ink">{pet.name}</h3>
          <span className="font-mono text-[11px] text-charcoal/55">
            {petAge(pet)}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-charcoal/70">
          {SPECIES_LABELS[pet.species]} · {pet.breed}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pet.vaccinated && (
            <span className="rounded-full bg-[#2F6F5E]/12 px-2 py-0.5 text-[10px] font-medium text-[#215144]">
              Vaccinated
            </span>
          )}
          {pet.medications.length > 0 && (
            <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-[10px] font-medium text-[#946412]">
              Meds
            </span>
          )}
          {pet.allergies.length > 0 && (
            <span className="rounded-full bg-leash/12 px-2 py-0.5 text-[10px] font-medium text-[#a83c27]">
              Allergies
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Compact pet summary card (brief §6). Three modes:
 *  - link (href)      → navigates to the pet detail/edit page
 *  - selectable       → toggle for the booking flow (selected + onSelect)
 *  - plain            → static summary
 */
export function PetCard({
  pet,
  href,
  selected,
  onSelect,
  className,
}: {
  pet: Pet;
  href?: string;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}) {
  const inner = <Meta pet={pet} />;
  const shell =
    "group flex items-center gap-4 rounded-[12px] border bg-white p-3 text-left transition-all duration-200";

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          shell,
          "w-full hover:-translate-y-0.5 hover:shadow-md",
          selected ? "border-leash ring-2 ring-leash/30" : "border-mist",
          className
        )}
      >
        {inner}
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            selected ? "border-leash bg-leash text-white" : "border-mist text-transparent"
          )}
          aria-hidden
        >
          <CheckIcon width={14} height={14} />
        </span>
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className={cn(shell, "border-mist hover:-translate-y-0.5 hover:shadow-md", className)}
      >
        {inner}
      </Link>
    );
  }

  return <div className={cn(shell, "border-mist", className)}>{inner}</div>;
}
