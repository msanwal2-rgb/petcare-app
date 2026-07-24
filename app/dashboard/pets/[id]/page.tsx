"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getPetById } from "@/lib/api/pets";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { PetForm } from "@/components/PetForm";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

export default function EditPetPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, hasHydrated } = useSession();
  const { data: pet, loading } = useAsync(() => getPetById(id), [id]);

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

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Edit {pet.name}</h1>
      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        <PetForm ownerId={pet.ownerId} pet={pet} />
      </div>
    </div>
  );
}
