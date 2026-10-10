import { Link } from "react-router";
import {
  CARE_GUIDES,
  RED_FLAGS,
  VACCINE_SCHEDULES,
} from "@/lib/content/pet-health";
import { ButtonLink } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Reveal } from "@/components/ui/Reveal";
import { AlertIcon, SyringeIcon, StethoscopeIcon } from "@/components/ui/icons";
import { SPECIES_LABELS } from "@/lib/utils";

/** The reference's `app/pet-health/page.tsx`, ported as-is. */
export default function PetHealthPage() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        Pet health
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        What to watch for, and when it&apos;s worth a visit
      </h1>
      <p className="mt-3 max-w-2xl text-charcoal/75">
        General guidance to help you judge urgency and ask better questions. It
        isn&apos;t a diagnosis — when something here matches what you&apos;re
        seeing, book a vet who can actually examine your animal.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <ButtonLink to="/vets" variant="cta">
          Find a vet
        </ButtonLink>
        <ButtonLink to="/store" variant="outline">
          Shop food &amp; supplements
        </ButtonLink>
      </div>

      {/* Red flags first — the section someone lands here at 2am needs. */}
      <Reveal className="mt-12">
        <h2
          id="emergencies"
          className="flex items-center gap-2 text-2xl font-semibold text-ink"
        >
          <AlertIcon width={22} height={22} className="text-leash" />
          Call a vet now
        </h2>
        <p className="mt-1 text-sm text-charcoal/70">
          These don&apos;t wait for an appointment slot. Phone the nearest
          emergency clinic rather than booking online.
        </p>
        <ul className="mt-4 space-y-3">
          {RED_FLAGS.map((flag) => (
            <li
              key={flag.sign}
              className="rounded-2xl border border-leash/25 bg-leash/[0.04] p-4"
            >
              <p className="font-medium text-ink">{flag.sign}</p>
              <p className="mt-1 text-sm text-charcoal/75">{flag.why}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-charcoal/50">
                {flag.species.map((s) => SPECIES_LABELS[s]).join(" · ")}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-charcoal/70">
          Several clinics on Leash take emergencies —{" "}
          <Link
            to="/vets?emergencyOnly=true"
            className="font-medium text-ink underline underline-offset-2 hover:text-leash"
          >
            see which ones
          </Link>
          .
        </p>
      </Reveal>

      {/* Vaccination schedules */}
      <Reveal className="mt-14">
        <h2
          id="vaccinations"
          className="flex items-center gap-2 text-2xl font-semibold text-ink"
        >
          <SyringeIcon width={22} height={22} />
          Vaccination schedules
        </h2>
        <p className="mt-1 text-sm text-charcoal/70">
          Typical timings. Your vet will adjust them for your pet&apos;s age,
          health and where you live — and everything they give goes into your
          pet&apos;s health record here.
        </p>

        <div className="mt-5 space-y-6">
          {VACCINE_SCHEDULES.map((schedule) => (
            <div
              key={schedule.species}
              className="overflow-hidden rounded-2xl border border-mist bg-white"
            >
              <div className="border-b border-mist bg-fog/60 px-5 py-3">
                <h3 className="font-semibold text-ink">{schedule.title}</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-mist text-xs uppercase tracking-wide text-charcoal/55">
                      <th className="px-5 py-2.5 font-medium">Vaccine</th>
                      <th className="px-5 py-2.5 font-medium">First dose</th>
                      <th className="px-5 py-2.5 font-medium">Boosters</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...schedule.core.map((r) => ({ row: r, core: true })),
                      ...schedule.optional.map((r) => ({ row: r, core: false })),
                    ].map(({ row, core }) => (
                      <tr key={row.name} className="border-b border-mist/70 last:border-0">
                        <td className="px-5 py-3 align-top">
                          <span className="font-medium text-ink">{row.name}</span>
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                              core
                                ? "bg-ink/8 text-ink"
                                : "bg-charcoal/6 text-charcoal/60"
                            }`}
                          >
                            {core ? "Core" : "Risk-based"}
                          </span>
                          <span className="mt-1 block text-xs text-charcoal/65">
                            {row.note}
                          </span>
                        </td>
                        <td className="px-5 py-3 align-top font-mono text-xs text-charcoal/80">
                          {row.firstDose}
                        </td>
                        <td className="px-5 py-3 align-top text-xs text-charcoal/80">
                          {row.boosters}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Practical guides */}
      <Reveal className="mt-14">
        <h2 className="flex items-center gap-2 text-2xl font-semibold text-ink">
          <StethoscopeIcon width={22} height={22} />
          Care guides
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {CARE_GUIDES.map((guide) => (
            <Panel key={guide.slug} title={guide.title}>
              <p className="text-sm text-charcoal/75">{guide.summary}</p>
              <ul className="mt-3 space-y-2 text-sm text-charcoal/85">
                {guide.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-marigold"
                      aria-hidden
                    />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </Reveal>

      <div className="mt-14 rounded-2xl border border-mist bg-white p-6 text-center">
        <h2 className="text-lg font-semibold text-ink">
          Something here sound familiar?
        </h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-charcoal/70">
          Book a licensed vet on Leash. Whatever they find gets written into your
          pet&apos;s health record, where your caretakers and your next vet can
          see it.
        </p>
        <ButtonLink to="/vets" variant="cta" size="lg" className="mt-4">
          Find a vet
        </ButtonLink>
      </div>
    </div>
  );
}
