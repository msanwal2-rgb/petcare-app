"use client";

import type { UserRole } from "@/types";
import { useSession } from "@/lib/store/session";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ROLE_LABELS } from "@/lib/utils";

/**
 * Role switch, driving the role-aware dashboard (brief §5).
 *
 * Renders one option per role the signed-in user actually holds, in a stable
 * order, and renders nothing at all for single-role users — so callers can
 * drop it in unconditionally.
 */
const ORDER: UserRole[] = ["owner", "caretaker", "vet"];

export function RoleToggle() {
  const { currentUser, activeRole, setActiveRole } = useSession();

  const segments = ORDER.filter((r) => currentUser?.roles.includes(r)).map(
    (role) => ({ value: role, label: ROLE_LABELS[role] })
  );

  return (
    <SegmentedControl
      segments={segments}
      value={activeRole}
      onChange={setActiveRole}
      size="sm"
      label="Switch role"
    />
  );
}
