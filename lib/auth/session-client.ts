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

/**
 * Only same-origin paths. `callbackUrl` comes off the query string, so treating
 * it as a destination without this check is an open redirect.
 */
function safeInternalPath(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/**
 * Navigate after signing in or out. A full document load, deliberately.
 *
 * Client-side routing cannot be trusted across an auth change. Visiting a
 * guarded route while signed out — by clicking it, or by Next prefetching it —
 * makes `proxy.ts` answer with a redirect to /login, and the App Router caches
 * that redirect against the route. `router.push` afterwards replays the cached
 * redirect and the user is bounced straight back to the login page, still
 * signed in, with no error to explain it. `router.refresh()` does not evict
 * that entry, and Next exposes no API that does.
 *
 * So we hand the URL to the browser instead. It discards every client cache and
 * the middleware re-evaluates against the new cookie. The cost is one page load
 * per sign-in, which is a fair price for the destination actually loading.
 *
 * `callbackUrl` is honoured on the way in, so someone bounced off /booking/new
 * lands back there rather than on a generic dashboard. Sign-out passes
 * `honorCallback: false` — a stale callbackUrl must not drag them back into
 * the app they just left.
 */
export function navigateAfterAuth(
  fallback: string,
  { honorCallback = true }: { honorCallback?: boolean } = {}
): void {
  const requested = honorCallback
    ? safeInternalPath(new URLSearchParams(window.location.search).get("callbackUrl"))
    : null;
  window.location.assign(requested ?? fallback);
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
