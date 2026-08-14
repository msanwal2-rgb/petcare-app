import Image from "next/image";
import type { ReactNode } from "react";
import { RatingStars } from "@/components/RatingStars";
import { MapPinIcon, ShieldCheckIcon } from "./icons";
import { Skeleton } from "./Skeleton";
import { BLUR_DATA_URL } from "@/lib/media/photos";

/**
 * The photo header shared by the caretaker and vet profile pages: full-bleed
 * portrait, gradient scrim, name and location over it, rating floated right.
 */
export function ProfileHero({
  imageUrl,
  name,
  verified,
  subtitle,
  city,
  state,
  rating,
  reviewCount,
  children,
}: {
  imageUrl: string;
  name: string;
  verified: boolean;
  /** Optional line between the name and the location, e.g. a clinic name. */
  subtitle?: string;
  city: string;
  state: string;
  rating: number;
  reviewCount: number;
  /** Extra content in the scrim, if a page needs it. */
  children?: ReactNode;
}) {
  return (
    <div className="relative h-56 sm:h-72">
      <Image
        src={imageUrl}
        alt={name}
        fill
        priority
        sizes="(max-width: 1024px) 100vw, 1200px"
        placeholder="blur"
        blurDataURL={BLUR_DATA_URL}
        className="object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-end justify-between gap-4 p-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold text-white">{name}</h1>
            {verified && (
              <ShieldCheckIcon className="text-marigold" width={22} height={22} />
            )}
          </div>
          {subtitle && <p className="mt-1 text-sm text-white/90">{subtitle}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
            <MapPinIcon width={15} height={15} />
            {city}, {state}
          </p>
          {children}
        </div>
        <div className="rounded-xl bg-white/95 px-4 py-2 backdrop-blur">
          <RatingStars rating={rating} reviewCount={reviewCount} />
        </div>
      </div>
    </div>
  );
}

/** Loading state for a profile page built on ProfileHero. */
export function ProfilePageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Skeleton className="h-56 w-full rounded-3xl sm:h-72" />
      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}
