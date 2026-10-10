import { Link, useNavigate, useParams } from "react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import type { Pet } from "@/types";
import { deletePet, getPetById } from "@/api/pets";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { PetForm } from "@/components/PetForm";
import { HealthRecordSection } from "@/components/vet/HealthRecordSection";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { DURATION, EASE_OUT } from "@/lib/motion";

const TABS = [
  { value: "details", label: "Details" },
  { value: "health", label: "Health record" },
] as const;

type Tab = (typeof TABS)[number]["value"];

/**
 * The reference's `app/dashboard/pets/[id]/page.tsx`, with two additions:
 *
 *  - **Only the owner gets the Details tab.** A treating vet arrives here from
 *    an appointment's "View health record"; the reference showed them an edit
 *    form the server refuses. They see the health record alone.
 *  - **The owner can remove the animal**, beneath the form. The reference had
 *    no way to; the API's `DELETE /pets/:id` answers 409 once the animal has
 *    clinical history (STATUS.md §5), and the message says why.
 */
export default function PetDetailPage() {
  const { id = "" } = useParams();
  const { currentUser, hasHydrated } = useSession();
  const { data: pet, loading } = useAsync(() => getPetById(id), [id]);
  const [tab, setTab] = useState<Tab>("details");

  if (!hasHydrated || loading)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-96 w-full rounded-2xl" />
      </div>
    );

  if (!currentUser) return <AuthRequired message="Log in to edit this pet." />;

  if (!pet)
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Pet not found"
          description="This pet may have been removed. Head back to your dashboard."
          actionLabel="Go to dashboard"
          actionHref="/dashboard"
        />
      </div>
    );

  const isOwner = pet.ownerId === currentUser.id;
  const shown: Tab = isOwner ? tab : "health";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link to="/dashboard" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink">{pet.name}</h1>

      {isOwner && (
        <SegmentedControl
          segments={TABS}
          value={tab}
          onChange={setTab}
          label="Pet sections"
          className="mt-5"
        />
      )}

      {/* Cross-fade between panels so switching reads as one surface changing
          rather than two pages swapping. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={shown}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          className="mt-6"
        >
          {shown === "details" ? (
            <>
              <div className="rounded-2xl border border-mist bg-white p-6">
                <PetForm pet={pet} />
              </div>
              <RemovePet pet={pet} />
            </>
          ) : (
            <HealthRecordSection pet={pet} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function RemovePet({ pet }: { pet: Pet }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await deletePet(pet.id);
      toast.success(`${pet.name} removed from your pets.`);
      navigate("/dashboard", { replace: true });
    } catch (e) {
      // A 409 is the guard against cascading away records the owner did not
      // author; the server's message explains it.
      toast.error(`Couldn’t remove ${pet.name}`, {
        description: e instanceof Error ? e.message : undefined,
      });
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <p className="mt-4 text-right text-sm text-charcoal/60">
      <button
        type="button"
        disabled={busy}
        onClick={() => (confirming ? remove() : setConfirming(true))}
        className="underline-offset-2 transition-colors hover:text-leash hover:underline disabled:opacity-50"
      >
        {confirming ? `Really remove ${pet.name}?` : `Remove ${pet.name}`}
      </button>
    </p>
  );
}
