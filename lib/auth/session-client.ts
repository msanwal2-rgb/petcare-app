"use client";

/**
 * Client-side session bridge. The real auth state lives in the Auth.js session
 * cookie; this keeps the existing Zustand `useSession` store in sync with it so
 * the ~13 components that read `currentUser` keep working unchanged.
 */

import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useSession as useStore } from "@/lib/store/session";
import type { User } from "@/types";
import { DEMO_PASSWORD } from "./demo";

/**
 * Navigate after signing in or out.
 *
 * Not just `router.push`. The App Router caches prefetched routes, and a
 * protected route prefetched while signed out caches `proxy.ts`'s redirect to
 * /login. A plain push afterwards replays that stale redirect and the user
 * never leaves the login page — which is exactly the bug this exists to stop.
 * `refresh()` drops the cache so the push is evaluated against the new session.
 *
 * Every sign-in and sign-out goes through here; none of them should call
 * `router.push` directly.
 */
export function useAuthNavigate(): (href: string) => void {
  const router = useRouter();
  return (href: string) => {
    router.refresh();
    router.push(href);
  };
}

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
