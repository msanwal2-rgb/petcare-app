import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Pet } from "@/types";
import { listMyPets } from "@/api/pets";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { SPECIES_LABELS, petAge } from "@/lib/utils";

/**
 * The owner's pets.
 *
 * Self-only: there is no owner id in the route and none in the request. The
 * reference project's URL was `/api/owners/:ownerId/pets` guarded by "is this
 * you?", which is a parameter that can only ever hold one value and a check
 * that can be forgotten.
 */
export default function PetsPage() {
  const [pets, setPets] = useState<Pet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    listMyPets()
      .then((rows) => {
        if (!cancelled) setPets(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Your pets</h1>
          <p className="mt-1 text-sm text-charcoal/60">
            What a sitter reads before a walk, and where a vet's notes land.
          </p>
        </div>
        <ButtonLink to="/dashboard/pets/new" variant="cta">
          Add a pet
        </ButtonLink>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-8 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
        >
          {error}
        </p>
      )}

      {pets === null && !error && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      {pets?.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-mist bg-white/60 p-10 text-center">
          <p className="text-sm text-charcoal/70">
            No pets yet. Adding one is what lets you book a sitter or a vet.
          </p>
          <ButtonLink to="/dashboard/pets/new" variant="outline" className="mt-5">
            Add your first pet
          </ButtonLink>
        </div>
      )}

      {pets && pets.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {pets.map((pet) => (
            <li key={pet.id}>
              <Link
                to={`/dashboard/pets/${pet.id}`}
                className="flex h-full items-center gap-4 rounded-2xl border border-mist bg-white p-4 transition-colors hover:border-ink"
              >
                <img
                  src={pet.photoUrl}
                  alt=""
                  width={64}
                  height={64}
                  className="size-16 shrink-0 rounded-xl bg-mist object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{pet.name}</p>
                  <p className="mt-0.5 truncate text-sm text-charcoal/60">
                    {SPECIES_LABELS[pet.species]} · {pet.breed} · {petAge(pet)}
                  </p>
                  {pet.allergies.length > 0 && (
                    <p className="mt-1.5 truncate font-mono text-[10px] uppercase tracking-widest text-leash">
                      Allergies: {pet.allergies.join(", ")}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
