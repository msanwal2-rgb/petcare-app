import Image from "next/image";
import { HeroSection } from "@/components/HeroSection";
import { FeaturedCaretakers } from "@/components/FeaturedCaretakers";
import { Reveal, RevealGroup } from "@/components/ui/Reveal";
import { ButtonLink } from "@/components/ui/Button";
import {
  SearchIcon,
  CalendarIcon,
  ShieldCheckIcon,
  HeartIcon,
} from "@/components/ui/icons";
import { unsplash, CTA_PHOTO, BLUR_DATA_URL } from "@/lib/mock-data/photos";

const STEPS = [
  {
    icon: SearchIcon,
    title: "Search nearby",
    body: "Filter local caretakers by service, dates, price, and the kind of pet you have.",
  },
  {
    icon: CalendarIcon,
    title: "Request a booking",
    body: "Pick your caretaker, attach your pet’s full profile, and send a request in a couple of taps.",
  },
  {
    icon: HeartIcon,
    title: "Relax — they’ve got it",
    body: "Your caretaker confirms, cares for your pet, and you both leave a review afterward.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex flex-col">
      <HeroSection />

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-[1200px] scroll-mt-20 px-4 py-20 sm:px-6">
        <Reveal>
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            How it works
          </p>
          <h2 className="mt-2 max-w-xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Three steps from “who’ll watch my dog?” to booked.
          </h2>
        </Reveal>
        <RevealGroup className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} delay={i * 0.08}>
              <div className="h-full rounded-2xl border border-mist bg-white p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink text-white">
                  <step.icon width={22} height={22} />
                </div>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="font-mono text-sm text-leash">0{i + 1}</span>
                  <h3 className="text-lg font-semibold text-ink">{step.title}</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-charcoal/70">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </RevealGroup>
      </section>

      {/* Featured caretakers */}
      <section className="mx-auto w-full max-w-[1200px] px-4 pb-20 sm:px-6">
        <Reveal className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-leash">
              Top rated near you
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Caretakers pet owners love
            </h2>
          </div>
          <ButtonLink href="/search" variant="outline" size="sm" className="shrink-0">
            See all
          </ButtonLink>
        </Reveal>
        <FeaturedCaretakers />
      </section>

      {/* Trust & safety */}
      <section id="trust" className="scroll-mt-20 bg-ink text-white">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-widest text-marigold">
              Trust &amp; safety
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Every caretaker is vetted before they meet your pet.
            </h2>
            <ul className="mt-8 space-y-5">
              {[
                ["Background-checked", "Identity and background verification through trusted third parties."],
                ["Full pet profiles", "Caretakers see medical, feeding, and behavior notes before every booking."],
                ["Reviewed both ways", "Owners and caretakers rate each other — reputation is earned."],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-marigold">
                    <ShieldCheckIcon width={18} height={18} />
                  </span>
                  <div>
                    <p className="font-semibold text-white">{title}</p>
                    <p className="mt-0.5 text-sm text-white/70">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
              <Image
                src={unsplash(CTA_PHOTO, 1000, 750)}
                alt="A caretaker hugging a happy dog"
                fill
                sizes="(max-width: 1024px) 100vw, 560px"
                placeholder="blur"
                blurDataURL={BLUR_DATA_URL}
                className="object-cover"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto w-full max-w-[1200px] px-4 py-20 sm:px-6">
        <Reveal className="overflow-hidden rounded-3xl border border-mist bg-white px-8 py-14 text-center sm:px-14">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Your pet deserves someone who shows up.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-charcoal/70">
            Join Leash as an owner to book care, or as a caretaker to earn doing
            what you love. It takes about a minute.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/search" variant="cta" size="lg">
              Find a caretaker
            </ButtonLink>
            <ButtonLink href="/signup" variant="outline" size="lg">
              Become a caretaker
            </ButtonLink>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
