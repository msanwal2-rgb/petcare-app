/**
 * Mock session store (brief §8). Holds the "current user" and their active
 * role. No real auth — login/signup just set a user here. Persisted to
 * localStorage so a refresh (and the dev account switcher) survives reloads.
 *
 * Swap-in note: when real auth lands, replace setUser/login/logout bodies with
 * calls to the auth provider; the store shape can stay the same.
 */

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
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

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: "leash-session",
      partialize: (s) => ({
        currentUser: s.currentUser,
        activeRole: s.activeRole,
      }),
      onRehydrateStorage: () => (state) => state?._setHydrated(),
    }
  )
);
