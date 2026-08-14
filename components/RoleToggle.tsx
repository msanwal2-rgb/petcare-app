"use client";

import { useSession } from "@/lib/store/session";
import { ROLE_LABELS, cn } from "@/lib/utils";

/**
 * Segmented role switch, driving the role-aware dashboard (brief §5).
 *
 * Renders one option per role the signed-in user actually holds, in a stable
 * order, and renders nothing at all for single-role users — so callers can
 * drop it in unconditionally.
 */
const ORDER = ["owner", "caretaker", "vet"] as const;

export function RoleToggle() {
  const { currentUser, activeRole, setActiveRole } = useSession();

  const roles = ORDER.filter((r) => currentUser?.roles.includes(r));
  if (roles.length < 2) return null;

  return (
    <div className="inline-flex rounded-full border border-mist bg-white p-0.5">
      {roles.map((role) => (
        <button
          key={role}
          onClick={() => setActiveRole(role)}
          aria-pressed={activeRole === role}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            activeRole === role
              ? "bg-ink text-white"
              : "text-charcoal/60 hover:text-ink"
          )}
        >
          {ROLE_LABELS[role]}
        </button>
      ))}
    </div>
  );
}
