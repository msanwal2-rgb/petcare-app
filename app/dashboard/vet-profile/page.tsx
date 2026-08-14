"use client";

import Link from "next/link";
import { useSession } from "@/lib/store/session";
import { getVetByUserId } from "@/lib/api/vets";
import { useAsync } from "@/lib/hooks/useAsync";
import { VetProfileForm } from "@/components/vet/VetProfileForm";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

export default function VetProfilePage() {
  const { currentUser, hasHydrated } = useSession();
  const isVet = !!currentUser?.roles.includes("vet");

  const { data: profile, loading } = useAsync(
    () =>
      currentUser && isVet ? getVetByUserId(currentUser.id) : Promise.resolve(null),
    [currentUser?.id, isVet]
  );

  if (!hasHydrated)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );

  if (!currentUser)
    return <AuthRequired message="Log in to manage your clinic profile." />;

  if (!isVet)
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="You're not registered as a vet yet"
          description="Add the vet role to your account to list your practice and start accepting appointments."
          actionLabel="Choose your roles"
          actionHref="/onboarding"
        />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink">
        {profile ? "Edit clinic profile" : "Create clinic profile"}
      </h1>
      <p className="mt-1 text-sm text-charcoal/60">
        This is what pet owners see when they search for a vet.
      </p>
      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <VetProfileForm userId={currentUser.id} profile={profile} />
        )}
      </div>
    </div>
  );
}
