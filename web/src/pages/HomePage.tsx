import { useEffect, useState } from "react";
import { ApiError } from "@/api/_client";
import { listBrands } from "@/api/catalog";
import { ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The landing page, in its M1 form.
 *
 * The reference project's `app/page.tsx` is a photography-led hero with
 * featured caretakers and a how-it-works section, and it depends on caretaker
 * search (M4) and the store (M6). It is ported when those exist; until then
 * this is an honest front door rather than a shell full of empty sections.
 *
 * The brands panel is M0's proof slice, kept because it is still the cheapest
 * check that every layer is connected: relative /api path → dev proxy →
 * controller → service → repository → Dapper → PostgreSQL, and the design
 * tokens on the way back.
 */
export default function HomePage() {
  const [brands, setBrands] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBrands()
      .then(setBrands)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? `${e.message} (${e.status})` : String(e)),
      );
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        M1 · identity &amp; authentication
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        Trusted pet care, booked in minutes
      </h1>
      <p className="mt-3 max-w-xl text-charcoal/70">
        Caretakers, licensed vets, and the food they recommend — in one place, so
        your pet&apos;s history follows them.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink to="/signup" variant="cta" size="lg">
          Create an account
        </ButtonLink>
        <ButtonLink to="/login" variant="outline" size="lg">
          Log in
        </ButtonLink>
      </div>

      <section className="mt-12 rounded-[var(--radius-card)] border border-mist bg-cloud p-6">
        <h2 className="text-lg font-semibold">Brands</h2>
        <p className="mt-1 text-sm text-charcoal/60">
          <code className="font-mono text-xs">GET /api/v1/brands</code> — live from
          the database, through the controller and repository layers.
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-leash/10 p-3 text-sm text-leash">{error}</p>
        )}

        {!error && brands === null && (
          <div className="mt-4 space-y-2" aria-busy="true">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-6 w-56" />
          </div>
        )}

        {brands && (
          <>
            <ul className="mt-4 flex flex-wrap gap-2">
              {brands.map((b) => (
                <li
                  key={b}
                  className="rounded-full bg-fog px-3 py-1 text-sm text-ink ring-1 ring-mist"
                >
                  {b}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-charcoal/60">
              {brands.length} brands · every layer verified.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
