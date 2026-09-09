import { Suspense } from "react";
import type { Metadata } from "next";
import { AdoptionResults } from "@/components/adoption/AdoptionResults";
import { PetCardSkeleton } from "@/components/PetCardSkeleton";

export const metadata: Metadata = {
  title: "Adopt a pet · Leash",
  description:
    "Animals looking for homes, from verified shelters and rescues. Each one comes with its health record.",
};

function Fallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[260px_1fr]">
        <div className="h-80 rounded-2xl border border-mist bg-white" />
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <PetCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdoptPage() {
  return (
    <>
      <section className="border-b border-mist bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            Adoption
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Every animal here comes with its history
          </h1>
          <p className="mt-3 max-w-2xl text-charcoal/70">
            Vaccinations, allergies, medications, the notes their foster carer
            wrote — all of it moves with them when you adopt, into the same
            health record their new vet will write in. No paper folder, no
            guessing what they have already had.
          </p>
        </div>
      </section>

      <Suspense fallback={<Fallback />}>
        <AdoptionResults />
      </Suspense>
    </>
  );
}
