"use client";

import Link from "next/link";
import Image from "next/image";
import type { AdoptionListingWithPet } from "@/types";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { formatCents, petAge } from "@/lib/utils";

/**
 * One animal in the directory.
 *
 * Leads with how long they have been waiting, which is the fact the shelter
 * most wants seen and the one a card would normally bury. An adoption listing
 * is not a product tile.
 */
function waitingFor(intakeAt: string): string | null {
  const days = Math.floor((Date.now() - Date.parse(intakeAt)) / 86_400_000);
  if (Number.isNaN(days) || days < 30) return null;
  const months = Math.floor(days / 30);
  return months >= 1
    ? `Waiting ${months} month${months === 1 ? "" : "s"}`
    : `Waiting ${days} days`;
}

export function AdoptionCard({ listing }: { listing: AdoptionListingWithPet }) {
  const { pet } = listing;
  const waiting = waitingFor(listing.intakeAt);

  return (
    <Link
      href={`/adopt/${listing.id}`}
      className="lift group block overflow-hidden rounded-2xl border border-mist bg-white"
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-fog">
        {pet.photoUrl && (
          <Image
            src={pet.photoUrl}
            alt={pet.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            className="lift-media object-cover"
          />
        )}
        {waiting && (
          <span className="absolute left-3 top-3">
            <StatusBadge tone="pending" label={waiting} />
          </span>
        )}
      </span>

      <span className="block p-4">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-base font-semibold text-ink">{pet.name}</span>
          <span className="font-mono text-sm text-charcoal/70">
            {listing.feeCents === 0 ? "No fee" : formatCents(listing.feeCents)}
          </span>
        </span>

        <span className="mt-0.5 block text-sm text-charcoal/70">
          {pet.breed} · {petAge(pet)} · {listing.location.city},{" "}
          {listing.location.state}
        </span>

        {listing.headline && (
          <span className="mt-2 block text-sm text-charcoal/80">
            {listing.headline}
          </span>
        )}

        <span className="mt-3 flex flex-wrap gap-1.5">
          {listing.goodWithKids === "yes" && (
            <StatusBadge tone="done" label="Good with kids" />
          )}
          {listing.goodWithDogs === "yes" && (
            <StatusBadge tone="done" label="Good with dogs" />
          )}
          {listing.goodWithCats === "yes" && (
            <StatusBadge tone="done" label="Good with cats" />
          )}
          {listing.specialNeeds && (
            <StatusBadge tone="pending" label="Special needs" />
          )}
        </span>

        <span className="mt-2 block font-mono text-xs text-charcoal/50">
          {listing.shelterName}
          {listing.distanceMiles !== undefined &&
            ` · ${listing.distanceMiles.toFixed(1)} mi`}
        </span>
      </span>
    </Link>
  );
}
