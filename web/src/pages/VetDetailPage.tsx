import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Review } from "@/types";
import { getVet, getVetReviewsForUser, type VetWithUser } from "@/api/vets";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  CONSULT_MODE_LABELS,
  SPECIALTY_LABELS,
  SPECIES_LABELS,
  formatCurrency,
  formatDate,
} from "@/lib/utils";

/**
 * One vet: the clinic, what they treat, when they are free, and what people say.
 *
 * Public — no guard, like the caretaker profile. An owner looking for a vet at
 * eleven at night should not have to sign up first, and everything here is the
 * public projection of the person: no email, no phone, no home coordinates.
 * Booking is where an account becomes necessary, and that route is guarded.
 *
 * ── The reviews are one-directional ──
 *
 * These are reviews **of** the clinic, filtered to `kind=vet_appointment`. There
 * is no reverse: a vet cannot review the client, which is why `Review.kind`
 * exists at all. A patient record carrying the clinician's opinion of the
 * owner is a different and much worse product.
 */
export default function VetDetailPage() {
  const { id = "" } = useParams();

  const [vet, setVet] = useState<VetWithUser | null | undefined>(undefined);
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    getVet(id).then(setVet).catch(() => setVet(null));
  }, [id]);

  useEffect(() => {
    if (!vet) return;
    getVetReviewsForUser(vet.user.id)
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [vet]);

  if (vet === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (vet === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Vet not found</h1>
        <ButtonLink to="/vets" variant="outline" className="mt-6">
          Back to search
        </ButtonLink>
      </div>
    );
  }

  const { profile, user } = vet;
  const openDays = profile.availability.filter((d) => d.slots.length > 0);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <section className="rounded-2xl border border-mist bg-white p-6">
        <div className="flex flex-wrap items-start gap-5">
          <img
            src={user.avatarUrl}
            alt=""
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-full bg-mist object-cover"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-ink">{user.name}</h1>
            <p className="mt-1 text-sm text-charcoal/60">
              {profile.clinicName} · {profile.clinic.city}, {profile.clinic.state}
            </p>
            <p className="mt-1 text-sm text-charcoal/70">
              {profile.rating.toFixed(1)} ★ · {profile.reviewCount} reviews ·{" "}
              {profile.responseRatePct}% response rate
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {profile.emergencyAvailable && (
                <span className="rounded-full bg-leash/10 px-2.5 py-1 text-xs font-medium text-leash">
                  Emergency cover
                </span>
              )}
              {profile.verificationStatus === "verified" && (
                <span className="rounded-full bg-mist/60 px-2.5 py-1 text-xs font-medium text-ink">
                  Licence verified
                </span>
              )}
            </div>
          </div>
          <ButtonLink to={`/appointment/new?vetId=${profile.id}`} variant="cta">
            Book a visit
          </ButtonLink>
        </div>

        {profile.bio && (
          <p className="mt-6 text-sm leading-relaxed text-charcoal/80">{profile.bio}</p>
        )}

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Detail
            label="Specialties"
            value={profile.specialties.map((s) => SPECIALTY_LABELS[s]).join(", ")}
          />
          <Detail
            label="Treats"
            value={profile.acceptedSpecies.map((s) => SPECIES_LABELS[s]).join(", ")}
          />
          <Detail
            label="Consultations"
            value={profile.consultModes.map((m) => CONSULT_MODE_LABELS[m]).join(", ")}
          />
          <Detail
            label="Experience"
            value={`${profile.yearsExperience} years`}
          />
          <Detail
            label="Licence"
            value={
              profile.licenseNumber
                ? `${profile.licenseNumber} (${profile.licenseState})`
                : "Not listed"
            }
          />
          <Detail
            label="Consultation fee"
            value={formatCurrency(profile.consultFee)}
          />
        </dl>

        <p className="mt-6 text-xs text-charcoal/50">
          The fee is taken from this profile when you book, not from the form —
          so what you are quoted is what this clinic charges.
        </p>
      </section>

      {openDays.length > 0 && (
        <section className="rounded-2xl border border-mist bg-white p-6">
          <h2 className="text-lg font-semibold text-ink">Availability</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {openDays.slice(0, 14).map((day) => (
              <li
                key={day.date}
                className="rounded-lg border border-mist px-3 py-1.5 text-xs text-charcoal/70"
              >
                {formatDate(day.date)}
                <span className="text-charcoal/45">
                  {" · "}
                  {day.slots.map((s) => `${s.start}–${s.end}`).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-mist bg-white p-6">
        <h2 className="text-lg font-semibold text-ink">Reviews</h2>

        {reviews.length === 0 ? (
          <p className="mt-3 text-sm text-charcoal/60">
            No reviews yet. They appear once a visit has been completed.
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {reviews.map((review) => (
              <li key={review.id} className="border-l-2 border-mist pl-4">
                <p className="text-sm text-charcoal/70">
                  {review.rating.toFixed(1)} ★
                  <span className="text-charcoal/45">
                    {" · "}
                    {formatDate(review.createdAt)}
                  </span>
                </p>
                {review.comment && (
                  <p className="mt-1 text-sm text-ink">{review.comment}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
