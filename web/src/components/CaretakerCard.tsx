import { Link } from "react-router";
import type { CaretakerWithUser } from "@/api/caretakers";
import { RatingStars } from "./RatingStars";
import { ServiceTypeChip } from "./ServiceTypeChip";
import { MapPinIcon, ShieldCheckIcon } from "./ui/icons";
import { Skeleton } from "./ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/photos";
import { formatCurrency } from "@/lib/utils";

/**
 * A caretaker, as a card.
 *
 * One component for two callers — the search results and the landing page's
 * featured strip. It was inlined in `SearchPage` until the landing page needed
 * the same thing; two copies of a card whose price badge and trust marker are
 * the product's first impression is exactly the drift worth avoiding.
 *
 * The hover lift and photo zoom are the `.lift` / `.lift-media` pair in
 * `index.css`, driven by CSS `group-hover` rather than by Framer. That keeps
 * this component cheap enough to render twenty of, and `prefers-reduced-motion`
 * disables both in one place.
 *
 * ── The shape note ──
 *
 * The reference's `CaretakerWithUser` was flat (`caretaker.rating`,
 * `caretaker.availability`). Ours nests — `{ profile, user, priceRange,
 * distanceMiles }` — because the API returns the profile and the *public*
 * projection of the person as separate objects. `profile.*` throughout is that
 * difference, not a typo.
 */
export function CaretakerCard({ caretaker }: { caretaker: CaretakerWithUser }) {
  const { profile, user, priceRange, distanceMiles } = caretaker;
  const openDays = profile.availability.filter((d) => d.slots.length > 0).length;

  return (
    <Link
      to={`/caretaker/${profile.id}`}
      className="lift group block rounded-[12px] border border-mist bg-white shadow-sm"
    >
      <div
        className="relative aspect-[4/3] overflow-hidden rounded-t-[12px]"
        style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
      >
        <img
          src={user.avatarUrl}
          alt={`${user.name}, pet caretaker`}
          loading="lazy"
          decoding="async"
          className="lift-media absolute inset-0 h-full w-full object-cover"
        />

        {profile.backgroundCheckStatus === "verified" && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink shadow-sm backdrop-blur">
            <ShieldCheckIcon width={13} height={13} className="text-[#2F6F5E]" />
            Background-checked
          </span>
        )}

        <span className="absolute bottom-3 right-3 rounded-full bg-ink/90 px-2.5 py-1 font-mono text-xs font-medium text-white backdrop-blur">
          {formatCurrency(priceRange.min)}
          {priceRange.max !== priceRange.min && `–${formatCurrency(priceRange.max)}`}
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{user.name}</h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-charcoal/65">
              <MapPinIcon width={13} height={13} />
              {user.address.city}, {user.address.state}
              {distanceMiles != null && (
                <span className="font-mono">· {distanceMiles.toFixed(1)} mi</span>
              )}
            </p>
          </div>
          <RatingStars rating={profile.rating} size="sm" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.servicesOffered.slice(0, 3).map((s) => (
            <ServiceTypeChip key={s} service={s} size="sm" />
          ))}
          {profile.servicesOffered.length > 3 && (
            <span className="font-mono text-[11px] text-charcoal/50">
              +{profile.servicesOffered.length - 3}
            </span>
          )}
        </div>

        <div className="mt-3.5 border-t border-mist pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-charcoal/55">Availability</span>
            <span className="font-mono text-charcoal/70">
              {openDays > 0 ? `${openDays} open days` : "Fully booked"}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {profile.availability.slice(0, 14).map((d) => (
              <span
                key={d.date}
                className={`h-1.5 flex-1 rounded-full ${
                  d.slots.length > 0 ? "bg-[#2F6F5E]/70" : "bg-mist"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Shimmer placeholder matching the card's layout, so the strip does not jump. */
export function CaretakerCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-mist bg-white shadow-sm">
      <Skeleton className="aspect-[4/3] rounded-b-none rounded-t-[12px]" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="w-full">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
        <div className="mt-3 flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="mt-3.5 border-t border-mist pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-1.5 w-full" />
        </div>
      </div>
    </div>
  );
}
