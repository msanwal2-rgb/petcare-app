import { SearchBar } from "./SearchBar";
import { BLUR_DATA_URL, HERO_PHOTO, unsplash } from "@/lib/photos";

/**
 * The landing hero: one real photograph filling most of the viewport with a
 * slow Ken Burns zoom on load, an overlay for legibility, the value
 * proposition, and the search widget. The single largest visual commitment in
 * the product.
 *
 * ── What `next/image` was doing, and what replaces it ──
 *
 * `fill` becomes `absolute inset-0 h-full w-full object-cover`;
 * `placeholder="blur"` becomes the same data URI as a CSS background on the
 * wrapper, revealed until the photo paints; `priority` becomes
 * `fetchPriority="high"` with no `loading="lazy"`, because this image is the
 * largest contentful paint and lazy-loading it would be actively wrong.
 * Format negotiation is already in the URL `lib/photos.ts` builds
 * (`auto=format`), so nothing is lost. Same reasoning as `Avatar.tsx`.
 *
 * `animate-ken-burns` and the reduced-motion override that disables it are both
 * in `index.css`.
 */
export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        className="absolute inset-0 -z-10"
        style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
      >
        <img
          src={unsplash(HERO_PHOTO, 2000, 1400)}
          alt="A dog walker heading out on a sunny walk with a happy dog"
          fetchPriority="high"
          decoding="async"
          className="animate-ken-burns absolute inset-0 h-full w-full object-cover"
        />
        {/* Legibility overlays: ink from the left for the headline, and from the
            bottom so the search bar keeps its contrast over a bright photo. */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/55 to-ink/20" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 to-transparent" />
      </div>

      <div className="mx-auto flex min-h-[86vh] max-w-[1200px] flex-col justify-center px-4 py-20 sm:px-6">
        <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 font-mono text-xs text-white backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-marigold" />
          Vetted, background-checked caretakers
        </span>

        <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Hand off the leash to someone{" "}
          <span className="text-marigold">competent.</span>
        </h1>

        <p className="mt-5 max-w-xl text-lg text-white/85">
          Find trusted local caretakers for walking, sitting, boarding and
          daycare — booked in minutes, with your pet&apos;s full profile
          attached.
        </p>

        <div className="mt-9 max-w-3xl">
          <SearchBar variant="hero" />
        </div>

        {/*
          The three figures are marketing copy, not derived numbers — the same
          as in the reference implementation. They are left as literals rather
          than wired to a stats endpoint because a seeded demo database would
          report "10 pets cared for", and a real one needs an aggregate nobody
          has specified. If they ever become live, they belong behind
          GET /config alongside the other published settings.
        */}
        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-white">
          {[
            ["4.8★", "average caretaker rating"],
            ["10k+", "happy pets cared for"],
            ["< 1 hr", "median response time"],
          ].map(([stat, label]) => (
            <div key={label}>
              <dt className="font-mono text-2xl font-semibold text-white">{stat}</dt>
              <dd className="text-sm text-white/70">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
