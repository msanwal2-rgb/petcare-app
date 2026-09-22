import { useEffect, useState } from "react";
import { useParams } from "react-router";
import type { Review } from "@/types";
import { getCaretaker, getReviewsForUser, type CaretakerWithUser } from "@/api/caretakers";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  SERVICE_LABELS,
  SPECIES_LABELS,
  formatCurrency,
  formatDate,
} from "@/lib/utils";

/**
 * One caretaker: who they are, what they charge, when they are free, and what
 * people say about them.
 *
 * Public — no guard. Browsing the marketplace is what brings people to it, and
 * everything here is the public projection of the person: no email, no phone,
 * no coordinates. The Book button is the point at which an account becomes
 * necessary, and the route it leads to is guarded.
 */
export default function CaretakerDetailPage() {
  const { id = "" } = useParams();

  const [caretaker, setCaretaker] = useState<CaretakerWithUser | null | undefined>(
    undefined,
  );
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    getCaretaker(id).then(setCaretaker).catch(() => setCaretaker(null));
  }, [id]);

  useEffect(() => {
    if (!caretaker) return;
    getReviewsForUser(caretaker.user.id, "booking")
      .then(setReviews)
      .catch(() => setReviews([]));
  }, [caretaker]);

  if (caretaker === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  if (caretaker === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Caretaker not found</h1>
        <ButtonLink to="/search" variant="outline" className="mt-6">
          Back to search
        </ButtonLink>
      </div>
    );
  }

  const { profile, user, priceRange } = caretaker;
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
              {user.address.city}, {user.address.state} · within{" "}
              {profile.serviceRadiusMiles} miles
            </p>
            <p className="mt-1 text-sm text-charcoal/70">
              {profile.rating.toFixed(1)} ★ · {profile.reviewCount} reviews ·{" "}
              {profile.responseRatePct}% response rate
            </p>
          </div>
          <ButtonLink to={`/booking/new?caretakerId=${profile.id}`} variant="cta">
            Book
          </ButtonLink>
        </div>

        {profile.bio && (
          <p className="mt-6 text-sm leading-relaxed text-charcoal/80">{profile.bio}</p>
        )}

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Detail
            label="Accepts"
            value={profile.acceptedSpecies.map((s) => SPECIES_LABELS[s]).join(", ")}
          />
          <Detail
            label="Background check"
            value={profile.backgroundCheckStatus}
          />
          <Detail
            label="Home"
            value={[
              profile.homeEnvironment.fencedYard && "Fenced yard",
              profile.homeEnvironment.hasOtherPets ? "Has other pets" : "No other pets",
              profile.homeEnvironment.smokeFree && "Smoke-free",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <Detail
            label="Certifications"
            value={profile.certifications.join(", ") || "None listed"}
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-mist bg-white p-6">
        <h2 className="text-lg font-semibold text-ink">Rates</h2>
        <p className="mt-1 text-sm text-charcoal/60">
          {formatCurrency(priceRange.min)}–{formatCurrency(priceRange.max)}. A booking
          is priced from this card, not from the form.
        </p>

        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {profile.pricing.map((entry) => (
            <li
              key={entry.serviceType}
              className="flex items-baseline justify-between rounded-xl border border-mist px-4 py-3"
            >
              <span className="text-sm text-ink">{SERVICE_LABELS[entry.serviceType]}</span>
              <span className="text-sm font-medium text-ink">
                {formatCurrency(entry.rate)}
                <span className="text-charcoal/50"> / {entry.unit}</span>
              </span>
            </li>
          ))}
        </ul>
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
            No reviews yet. They appear once a booking has been completed.
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
