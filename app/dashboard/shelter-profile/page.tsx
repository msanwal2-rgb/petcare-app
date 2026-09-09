"use client";

import Link from "next/link";
import { getShelterByUserId } from "@/lib/api/shelters";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ShelterProfileForm } from "@/components/shelter/ShelterProfileForm";

export default function ShelterProfilePage() {
  const { currentUser, hasHydrated } = useSession();
  const isShelter = !!currentUser?.roles.includes("shelter");

  const { data: profile, loading } = useAsync(
    () =>
      currentUser && isShelter
        ? getShelterByUserId(currentUser.id)
        : Promise.resolve(null),
    [currentUser?.id, isShelter]
  );

  if (!hasHydrated) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) {
    return <AuthRequired message="Log in to manage your shelter profile." />;
  }

  if (!isShelter) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="You're not registered as a shelter yet"
          description="Choose that role and you can list animals for adoption."
          actionLabel="Choose your roles"
          actionHref="/onboarding"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Link
        href="/dashboard"
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
        {profile ? "Edit shelter profile" : "Create shelter profile"}
      </h1>
      <p className="mt-1 text-sm text-charcoal/70">
        This is what an adopter sees before they decide whether to apply.
      </p>

      <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
        {loading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <ShelterProfileForm userId={currentUser.id} profile={profile} />
        )}
      </div>
    </div>
  );
}
