"use client";

import Link from "next/link";
import { useSession } from "@/lib/store/session";
import { PetForm } from "@/components/PetForm";
import { AuthRequired } from "@/components/AuthRequired";
import { Skeleton } from "@/components/ui/Skeleton";

export default function NewPetPage() {
  const { currentUser, hasHydrated } = useSession();

  if (!hasHydrated)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  if (!currentUser) return <AuthRequired message="Log in to add a pet." />;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link
        href="/dashboard"
        className="text-sm text-charcoal/60 hover:text-ink"
      >
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Add a pet</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        The more your caretaker knows, the better the care. You can edit this
        any time.
      </p>
      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        <PetForm ownerId={currentUser.id} />
      </div>
    </div>
  );
}
