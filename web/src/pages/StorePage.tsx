import { Link } from "react-router";
import { StoreCatalog } from "@/components/store/StoreCatalog";

/** The shop — the reference's `app/store/page.tsx`. */
export default function StorePage() {
  return (
    <>
      <section className="border-b border-mist bg-white">
        <div className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            Store
          </p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Food that fits the pet in your health record
          </h1>
          <p className="mt-3 max-w-2xl text-charcoal/75">
            Pick a pet and the shelf narrows to their species and life stage,
            anything they react to gets flagged, and the therapeutic diets their
            vet prescribed unlock automatically. Every order is tracked from our
            shelf to your door.
          </p>
          <p className="mt-4 text-sm text-charcoal/70">
            Not sure what they need?{" "}
            <Link
              to="/pet-health"
              className="font-medium text-ink underline underline-offset-2 hover:text-leash"
            >
              Read the nutrition guide
            </Link>
            .
          </p>
        </div>
      </section>

      <StoreCatalog />
    </>
  );
}
