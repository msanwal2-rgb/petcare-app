"use client";

import { useSession } from "@/lib/store/session";
import { OwnerDashboard } from "@/components/dashboard/OwnerDashboard";
import { CaretakerDashboard } from "@/components/dashboard/CaretakerDashboard";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { RoleToggle } from "@/components/RoleToggle";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { Skeleton } from "@/components/ui/Skeleton";

export default function DashboardPage() {
  const { currentUser, activeRole, hasHydrated } = useSession();

  if (!hasHydrated) {
    return (
      <div className="mx-auto w-full max-w-[1000px] px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired />;

  if (currentUser.roles.length === 0)
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Finish setting up your account"
          description="Tell us whether you’re here to book care, offer care, or both."
          actionLabel="Choose your roles"
          actionHref="/onboarding"
        />
      </div>
    );

  const both = currentUser.roles.length === 2;
  // Which view: dual-role users follow the header toggle; single-role users
  // see their only role regardless of the stored activeRole.
  const view = both
    ? activeRole
    : currentUser.roles[0];

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-10 sm:px-6">
      <VerifyEmailBanner />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            {view === "owner" ? "Owner dashboard" : "Caretaker dashboard"}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            Welcome back, {currentUser.name.split(" ")[0]}
          </h1>
        </div>
        {both && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-charcoal/50">Viewing as</span>
            <RoleToggle />
          </div>
        )}
      </div>

      {view === "owner" ? (
        <OwnerDashboard user={currentUser} />
      ) : (
        <CaretakerDashboard user={currentUser} />
      )}
    </div>
  );
}
