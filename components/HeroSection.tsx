import Image from "next/image";
import { SearchBar } from "./SearchBar";
import { unsplash, HERO_PHOTO, BLUR_DATA_URL } from "@/lib/media/photos";

/**
 * Landing hero (brief §3, §6): one strong real photo filling most of the
 * viewport with a slow Ken Burns zoom on load, an overlay for legibility, the
 * value prop, and the search widget. The single largest visual commitment.
 */
export function HeroSection() {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <Image
          src={unsplash(HERO_PHOTO, 2000, 1400)}
          alt="A dog walker heading out on a sunny walk with a happy dog"
          fill
          priority
          placeholder="blur"
          blurDataURL={BLUR_DATA_URL}
          sizes="100vw"
          className="animate-ken-burns object-cover"
        />
        {/* legibility overlay — ink gradient from the left */}
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
          Find trusted local caretakers for walking, sitting, boarding, and
          daycare — booked in minutes, with your pet’s full profile attached.
        </p>

        <div className="mt-9 max-w-3xl">
          <SearchBar variant="hero" />
        </div>

        <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4 text-white">
          {[
            ["4.8★", "average caretaker rating"],
            ["10k+", "happy pets cared for"],
            ["< 1 hr", "median response time"],
          ].map(([stat, label]) => (
            <div key={label}>
              <dt className="font-mono text-2xl font-semibold text-white">
                {stat}
              </dt>
              <dd className="text-sm text-white/70">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
