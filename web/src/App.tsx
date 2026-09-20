import { useEffect, useState } from "react";
import { listBrands } from "./api/catalog";
import { ApiError } from "./api/_client";

/**
 * M0 proof slice.
 *
 * Deliberately the smallest thing that exercises every layer at once:
 * Vite → the relative /api path → the dev proxy → ASP.NET → Dapper → Postgres,
 * and the design tokens on the way back. If this renders, the foundation holds
 * and everything after it is ordinary work.
 *
 * Replaced by the real route tree in M1.
 */
export default function App() {
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
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        M0 · foundation
      </p>
      <h1 className="mt-2 text-4xl font-semibold">Leash</h1>
      <p className="mt-3 text-charcoal/70">
        React + Vite → ASP.NET Core 10 → Dapper → PostgreSQL 18.
      </p>

      <section className="mt-10 rounded-[var(--radius-card)] border border-mist bg-cloud p-6">
        <h2 className="text-lg font-semibold">Brands</h2>
        <p className="mt-1 text-sm text-charcoal/60">
          <code className="font-mono text-xs">GET /api/v1/brands</code> — live from
          the database, through the dev proxy.
        </p>

        {error && (
          <p className="mt-4 rounded-md bg-leash/10 p-3 text-sm text-leash">{error}</p>
        )}

        {!error && brands === null && (
          <div className="mt-4 space-y-2" aria-busy="true">
            <div className="shimmer h-6 w-40 rounded-md" />
            <div className="shimmer h-6 w-56 rounded-md" />
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
    </main>
  );
}
