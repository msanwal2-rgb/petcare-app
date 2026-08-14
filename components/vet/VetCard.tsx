import Image from "next/image";
import Link from "next/link";
import type { VetWithUser } from "@/types";
import { RatingStars } from "@/components/RatingStars";
import { MapPinIcon, AlertIcon } from "@/components/ui/icons";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
import { CONSULT_MODE_LABELS, SPECIALTY_LABELS, formatCurrency } from "@/lib/utils";

/**
 * Vet search-result card. Deliberately the same silhouette as CaretakerCard —
 * an owner browsing for care shouldn't have to learn a second layout — but
 * the trust markers are the ones that matter for clinical care: specialties,
 * licence, years in practice, and whether they take emergencies.
 */
export function VetCard({ vet }: { vet: VetWithUser }) {
  const { user } = vet;

  return (
    <Link
      href={`/vets/${vet.id}`}
      className="group block rounded-[12px] border border-mist bg-white shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-lg hover:shadow-ink/5 focus-visible:-translate-y-1"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-t-[12px]">
        <Image
          src={user.avatarUrl}
          alt={`${user.name}, veterinarian`}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        {vet.emergencyAvailable && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-[#a83c27] shadow-sm backdrop-blur">
            <AlertIcon width={13} height={13} />
            Takes emergencies
          </span>
        )}
        <span className="absolute bottom-3 right-3 rounded-full bg-ink/90 px-2.5 py-1 font-mono text-xs font-medium text-white backdrop-blur">
          {formatCurrency(vet.consultFee)} consult
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{user.name}</h3>
            <p className="mt-0.5 truncate text-xs text-charcoal/65">{vet.clinicName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-charcoal/65">
              <MapPinIcon width={13} height={13} />
              {vet.clinic.city}, {vet.clinic.state}
              {vet.distanceMiles != null && (
                <span className="font-mono">· {vet.distanceMiles} mi</span>
              )}
            </p>
          </div>
          <RatingStars rating={vet.rating} size="sm" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {vet.specialties.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-full border border-mist bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-charcoal"
            >
              {SPECIALTY_LABELS[s]}
            </span>
          ))}
          {vet.specialties.length > 3 && (
            <span className="font-mono text-[11px] text-charcoal/50">
              +{vet.specialties.length - 3}
            </span>
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-mist pt-3 text-[11px]">
          <span className="text-charcoal/55">
            {vet.yearsExperience} yrs · licence {vet.licenseState}
          </span>
          <span className="font-mono text-charcoal/70">
            {vet.consultModes.map((m) => CONSULT_MODE_LABELS[m]).join(" · ")}
          </span>
        </div>
      </div>
    </Link>
  );
}
