import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { VetSearchResults } from "@/components/vet/VetSearchResults";
import { CaretakerCardSkeleton } from "@/components/CaretakerCardSkeleton";

export const metadata: Metadata = {
  title: "Find a vet",
  description:
    "Book licensed veterinarians for in-clinic visits, video consultations, and home visits. Every visit is written into your pet's health record.",
};

function VetsFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <CaretakerCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function VetsPage() {
  return (
    <>
      <section className="border-b border-mist bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            Pet doctor
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Licensed vets, booked the same way you book care
          </h1>
          <p className="mt-3 max-w-2xl text-charcoal/75">
            In-clinic, video, or at home. Everything from the visit — notes,
            vaccinations, prescriptions — lands in your pet&apos;s health record,
            where your caretakers and your next vet can actually use it.
          </p>
          <p className="mt-4 text-sm text-charcoal/70">
            Not sure whether it&apos;s urgent?{" "}
            <Link
              href="/pet-health"
              className="font-medium text-ink underline underline-offset-2 hover:text-leash"
            >
              Read the care guides
            </Link>
            .
          </p>
        </div>
      </section>

      <Suspense fallback={<VetsFallback />}>
        <VetSearchResults />
      </Suspense>
    </>
  );
}
