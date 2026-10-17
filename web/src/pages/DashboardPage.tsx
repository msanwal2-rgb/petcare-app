import type { UserRole } from "@/types";
import { useSession } from "@/store/session";
import { OwnerDashboard } from "@/components/dashboard/OwnerDashboard";
import { CaretakerDashboard } from "@/components/dashboard/CaretakerDashboard";
import { VetDashboard } from "@/components/dashboard/VetDashboard";
import { ShelterDashboard } from "@/components/dashboard/ShelterDashboard";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { RoleToggle } from "@/components/RoleToggle";
import { VerifyEmailBanner } from "@/components/VerifyEmailBanner";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The reference's `app/dashboard/page.tsx`: one page that switches by role.
 */
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

  // Which view: multi-role users follow the header toggle; single-role users
  // see their only role. The `includes` guard matters because activeRole is a
  // cached client value that can outlive a role being removed.
  const canSwitch = currentUser.roles.length > 1;
  const view =
    canSwitch && currentUser.roles.includes(activeRole)
      ? activeRole
      : currentUser.roles[0];

  const HEADINGS: Record<UserRole, string> = {
    owner: "Owner dashboard",
    caretaker: "Caretaker dashboard",
    vet: "Vet dashboard",
    shelter: "Shelter dashboard",
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 py-10 sm:px-6">
      <VerifyEmailBanner />
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            {HEADINGS[view]}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">
            Welcome back, {currentUser.name.split(" ")[0]}
          </h1>
        </div>
        {canSwitch && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-charcoal/50">Viewing as</span>
            <RoleToggle />
          </div>
        )}
      </div>

      {view === "owner" && <OwnerDashboard user={currentUser} />}
      {view === "caretaker" && <CaretakerDashboard user={currentUser} />}
      {view === "vet" && <VetDashboard user={currentUser} />}
      {view === "shelter" && <ShelterDashboard user={currentUser} />}
    </div>
  );
}
