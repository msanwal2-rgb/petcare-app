"use client";

/**
 * Client-side session bridge. The real auth state lives in the Auth.js session
 * cookie; this keeps the existing Zustand `useSession` store in sync with it so
 * the ~13 components that read `currentUser` keep working unchanged.
 */

import { signIn, signOut } from "next-auth/react";
import { useSession as useStore } from "@/lib/store/session";
import type { User } from "@/types";
import { DEMO_PASSWORD } from "./demo";

/** Pull the authenticated user from the server and push it into the store. */
export async function refreshSessionUser(): Promise<User | null> {
  let user: User | null = null;
  try {
    const res = await fetch("/api/me", { cache: "no-store" });
    if (res.ok) user = (await res.json()) as User;
  } catch {
    /* offline / network — treat as signed out */
  }
  useStore.getState().setUser(user);
  useStore.getState()._setHydrated();
  return user;
}

/** Email + password sign-in. Throws on bad credentials. */
export async function loginWithPassword(email: string, password: string): Promise<User> {
  const res = await signIn("credentials", { email, password, redirect: false });
  if (!res || res.error) throw new Error("Invalid email or password");
  const user = await refreshSessionUser();
  if (!user) throw new Error("Could not load your account");
  return user;
}

/** One-tap demo login (uses the shared demo password). */
export function loginAsDemo(email: string): Promise<User> {
  return loginWithPassword(email, DEMO_PASSWORD);
}

/** Start the Google OAuth flow (redirects). */
export function loginWithGoogle(): void {
  void signIn("google", { callbackUrl: "/dashboard" });
}

/** Sign out everywhere: clear the Auth.js cookie and the local store. */
export async function logout(): Promise<void> {
  useStore.getState().logout();
  await signOut({ redirect: false });
}
