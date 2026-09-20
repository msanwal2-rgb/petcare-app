/**
 * Client session store. With real auth (Auth.js) the source of truth is the
 * server session cookie; this store is a client-side cache of the current user,
 * hydrated on load by <SessionSync/> via /api/me. It is deliberately NOT
 * persisted to localStorage anymore — a stale/spoofed local value can't grant
 * access because every write endpoint re-checks the real session server-side.
 */

import { create } from "zustand";
import type { User, UserRole } from "@/types";

interface SessionState {
  currentUser: User | null;
  /** Which hat the user is wearing when they hold both roles. */
  activeRole: UserRole;
  hasHydrated: boolean;
  setUser: (user: User | null) => void;
  setActiveRole: (role: UserRole) => void;
  logout: () => void;
  _setHydrated: () => void;
}

export const useSession = create<SessionState>()((set) => ({
  currentUser: null,
  activeRole: "owner",
  hasHydrated: false,
  setUser: (user) =>
    set({
      currentUser: user,
      activeRole: user?.roles.includes("owner")
        ? "owner"
        : user?.roles[0] ?? "owner",
    }),
  setActiveRole: (role) => set({ activeRole: role }),
  logout: () => set({ currentUser: null, activeRole: "owner" }),
  _setHydrated: () => set({ hasHydrated: true }),
}));
