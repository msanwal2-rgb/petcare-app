"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { UserRole } from "@/types";
import { updateUser } from "@/lib/api/users";
import { useSession } from "@/lib/store/session";
import { navigateAfterAuth } from "@/lib/auth/session-client";
import { AuthRequired } from "@/components/AuthRequired";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { HomeIcon, PawIcon, CheckIcon, StethoscopeIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const OPTIONS: {
  role: UserRole;
  title: string;
  body: string;
  icon: typeof PawIcon;
}[] = [
  {
    role: "owner",
    title: "I have a pet",
    body: "Find and book trusted caretakers for walking, sitting, boarding, and daycare.",
    icon: PawIcon,
  },
  {
    role: "caretaker",
    title: "I want to care for pets",
    body: "List your services and availability, and earn money doing what you love.",
    icon: HomeIcon,
  },
  {
    role: "vet",
    title: "I'm a veterinarian",
    body: "List your practice, take appointments, and write straight into your patients' health records.",
    icon: StethoscopeIcon,
  },
];

/**
 * Where to land after choosing roles. A caretaker or vet is invisible in search
 * until their profile exists, so send them there first; anyone who is also an
 * owner has a dashboard worth seeing immediately.
 */
function nextStepFor(roles: UserRole[]): string {
  if (roles.includes("owner")) return "/dashboard";
  if (roles.includes("vet")) return "/dashboard/vet-profile";
  if (roles.includes("caretaker")) return "/dashboard/caretaker-profile";
  return "/dashboard";
}

export default function OnboardingPage() {
  const { currentUser, setUser, hasHydrated } = useSession();
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [saving, setSaving] = useState(false);

  if (!hasHydrated)
    return (
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6">
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  if (!currentUser)
    return <AuthRequired message="Create an account to get started." />;

  function toggle(role: UserRole) {
    setRoles((r) => (r.includes(role) ? r.filter((x) => x !== role) : [...r, role]));
  }

  async function finish() {
    if (roles.length === 0) {
      toast.error("Pick at least one — you can always add the other later.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateUser(currentUser!.id, { roles });
      setUser(updated);
      toast.success("You’re all set!");
      // Send professionals straight to the profile they can't be found without.
      navigateAfterAuth(nextStepFor(roles));
    } catch {
      toast.error("Couldn’t save. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        Welcome, {currentUser.name.split(" ")[0]}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        How will you use Leash?
      </h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Pick any that apply — you can change this anytime.
      </p>

      <div className="mt-6 space-y-3">
        {OPTIONS.map((opt) => {
          const on = roles.includes(opt.role);
          return (
            <button
              key={opt.role}
              type="button"
              onClick={() => toggle(opt.role)}
              aria-pressed={on}
              className={cn(
                "flex w-full items-start gap-4 rounded-2xl border-2 bg-white p-5 text-left transition-all",
                on ? "border-leash ring-2 ring-leash/20" : "border-mist hover:border-ink/30"
              )}
            >
              <span
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                  on ? "bg-leash text-white" : "bg-ink/5 text-ink"
                )}
              >
                <opt.icon width={22} height={22} />
              </span>
              <span className="flex-1">
                <span className="block font-semibold text-ink">{opt.title}</span>
                <span className="mt-0.5 block text-sm text-charcoal/65">
                  {opt.body}
                </span>
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                  on ? "border-leash bg-leash text-white" : "border-mist text-transparent"
                )}
              >
                <CheckIcon width={14} height={14} />
              </span>
            </button>
          );
        })}
      </div>

      <Button
        variant="cta"
        size="lg"
        className="mt-6 w-full"
        onClick={finish}
        disabled={saving}
      >
        {saving ? "Setting up…" : "Continue"}
      </Button>
    </div>
  );
}
