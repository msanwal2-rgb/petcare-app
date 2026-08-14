"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { getPetById } from "@/lib/api/pets";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { PetForm } from "@/components/PetForm";
import { HealthRecordSection } from "@/components/vet/HealthRecordSection";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

type Tab = "details" | "health";

export default function PetDetailPage() {
  const { id } = useParams<{ id: string }>();
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="text-sm text-charcoal/60 hover:text-ink">
        ← Back to dashboard
      </Link>
      <h1 className="mt-3 text-2xl font-semibold text-ink">{pet.name}</h1>

      <div
        role="tablist"
        aria-label="Pet sections"
        className="mt-5 inline-flex rounded-full border border-mist bg-white p-0.5"
      >
        {(
          [
            ["details", "Details"],
            ["health", "Health record"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              tab === value ? "bg-ink text-white" : "text-charcoal/65 hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "details" ? (
          <div className="rounded-2xl border border-mist bg-white p-6">
            <PetForm ownerId={pet.ownerId} pet={pet} />
          </div>
        ) : (
          <HealthRecordSection pet={pet} />
        )}
      </div>
    </div>
  );
}
