import Image from "next/image";
import Link from "next/link";
import type { CaretakerWithUser } from "@/types";
import { RatingStars } from "./RatingStars";
import { ServiceTypeChip } from "./ServiceTypeChip";
import { MapPinIcon, ShieldCheckIcon } from "./ui/icons";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
import { formatCurrency } from "@/lib/utils";

/**
 * Search-result card, styled like an ID-tag / appointment card (brief §3):
 * rounded 12px, service chips, a mini availability strip. Hover lifts the card
 * and subtly zooms the photo — done with CSS group-hover so this stays a light
 * server component and the motion is auto-disabled under prefers-reduced-motion.
 */
export function CaretakerCard({ caretaker }: { caretaker: CaretakerWithUser }) {
  const { user, priceRange } = caretaker;
  const openDays = caretaker.availability.filter((d) => d.slots.length > 0).length;

  return (
    <Link
      href={`/caretaker/${caretaker.id}`}
      className="group block rounded-[12px] border border-mist bg-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-ink/5 focus-visible:-translate-y-1"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-[12px]">
        <Image
          src={user.avatarUrl}
          alt={`${user.name}, pet caretaker`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {/* background-check trust marker */}
        {caretaker.backgroundCheckStatus === "verified" && (
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
            <h3 className="truncate text-base font-semibold text-ink">
              {user.name}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-charcoal/65">
              <MapPinIcon width={13} height={13} />
              {user.address.city}, {user.address.state}
              {caretaker.distanceMiles != null && (
                <span className="font-mono">· {caretaker.distanceMiles} mi</span>
              )}
            </p>
          </div>
          <RatingStars rating={caretaker.rating} size="sm" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {caretaker.servicesOffered.slice(0, 3).map((s) => (
            <ServiceTypeChip key={s} service={s} size="sm" />
          ))}
          {caretaker.servicesOffered.length > 3 && (
            <span className="font-mono text-[11px] text-charcoal/50">
              +{caretaker.servicesOffered.length - 3}
            </span>
          )}
        </div>

        {/* mini availability strip */}
        <div className="mt-3.5 border-t border-mist pt-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-charcoal/55">Next 3 weeks</span>
            <span className="font-mono text-charcoal/70">
              {openDays > 0 ? `${openDays} open days` : "Fully booked"}
            </span>
          </div>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {caretaker.availability.slice(0, 14).map((d) => (
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
