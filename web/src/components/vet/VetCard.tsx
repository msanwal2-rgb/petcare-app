import { Link } from "react-router";
import type { VetWithUser } from "@/api/vets";
import { RatingStars } from "@/components/RatingStars";
import { MapPinIcon, AlertIcon } from "@/components/ui/icons";
import { BLUR_DATA_URL } from "@/lib/photos";
import { CONSULT_MODE_LABELS, SPECIALTY_LABELS, formatCurrency } from "@/lib/utils";

/**
 * Vet search-result card. Deliberately the same silhouette as CaretakerCard —
 * an owner browsing for care shouldn't have to learn a second layout — but
 * the trust markers are the ones that matter for clinical care: specialties,
 * licence, years in practice, and whether they take emergencies.
 */
export function VetCard({ vet }: { vet: VetWithUser }) {
  const { profile, user, distanceMiles } = vet;

  return (
    <Link
      to={`/vets/${profile.id}`}
      className="lift group block rounded-[12px] border border-mist bg-white shadow-sm"
    >
      <div
        className="relative aspect-[4/3] overflow-hidden rounded-t-[12px]"
        style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
      >
        <img
          src={user.avatarUrl}
          alt={`${user.name}, veterinarian`}
          loading="lazy"
          decoding="async"
          className="lift-media absolute inset-0 h-full w-full object-cover"
        />
        {profile.emergencyAvailable && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-[#a83c27] shadow-sm backdrop-blur">
            <AlertIcon width={13} height={13} />
            Takes emergencies
          </span>
        )}
        <span className="absolute bottom-3 right-3 rounded-full bg-ink/90 px-2.5 py-1 font-mono text-xs font-medium text-white backdrop-blur">
          {formatCurrency(profile.consultFee)} consult
        </span>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-ink">{user.name}</h3>
            <p className="mt-0.5 truncate text-xs text-charcoal/65">{profile.clinicName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-charcoal/65">
              <MapPinIcon width={13} height={13} />
              {profile.clinic.city}, {profile.clinic.state}
              {distanceMiles != null && (
                <span className="font-mono">· {distanceMiles.toFixed(1)} mi</span>
              )}
            </p>
          </div>
          <RatingStars rating={profile.rating} size="sm" />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.specialties.slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-full border border-mist bg-white px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-charcoal"
            >
              {SPECIALTY_LABELS[s]}
            </span>
          ))}
          {profile.specialties.length > 3 && (
            <span className="font-mono text-[11px] text-charcoal/50">
              +{profile.specialties.length - 3}
            </span>
          )}
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-mist pt-3 text-[11px]">
          <span className="text-charcoal/55">
            {profile.yearsExperience} yrs · licence {profile.licenseState}
          </span>
          <span className="font-mono text-charcoal/70">
            {profile.consultModes.map((m) => CONSULT_MODE_LABELS[m]).join(" · ")}
          </span>
        </div>
      </div>
    </Link>
  );
}

