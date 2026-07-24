"use client";

import { useSession } from "@/lib/store/session";
import type { UserRole } from "@/types";
import { cn } from "@/lib/utils";

const OPTIONS: { role: UserRole; label: string }[] = [
  { role: "owner", label: "Owner" },
  { role: "caretaker", label: "Caretaker" },
];

/** Segmented owner/caretaker switch for dual-role users — drives the
 *  role-aware dashboard (brief §5). Only rendered when the user holds both. */
export function RoleToggle() {
  const { activeRole, setActiveRole } = useSession();
  return (
    <div className="inline-flex rounded-full border border-mist bg-white p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.role}
          onClick={() => setActiveRole(opt.role)}
          aria-pressed={activeRole === opt.role}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            activeRole === opt.role
              ? "bg-ink text-white"
              : "text-charcoal/60 hover:text-ink"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
