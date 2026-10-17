import type { StaffRole } from "@/types";

/** "Any staff role at all" — the console's overview (REQUIREMENTS.md §10.2). */
export type ConsoleRole = StaffRole | "any";

/**
 * Whether these staff roles open a section. `admin` satisfies every role, as
 * it does on the server. Courtesy only: every admin endpoint re-checks.
 */
export function holdsRole(held: StaffRole[] | undefined, role: ConsoleRole): boolean {
  if (!held || held.length === 0) return false;
  return role === "any" || held.includes("admin") || held.includes(role);
}
