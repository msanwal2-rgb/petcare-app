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
  if (!res || res.error) {
    // Auth.js reports our thrown CredentialsSignin subclasses by `code`. Only
    // the throttle is worth distinguishing: telling someone "wrong password"
    // versus "no such account" is what makes an address list enumerable.
    throw new Error(
      res?.code === "RateLimited"
        ? "Too many sign-in attempts. Try again in a few minutes."
        : "Invalid email or password"
    );
  }
  const user = await refreshSessionUser();
  if (!user) throw new Error("Could not load your account");
  return user;
}

/** One-tap demo login (uses the shared demo password). */
export function loginAsDemo(email: string): Promise<User> {
  return loginWithPassword(email, DEMO_PASSWORD);
}

/**
 * Start the Google OAuth flow (redirects).
 *
 * Honours the page's own `callbackUrl` through the same same-origin check the
 * password path uses, so someone bounced off /booking/new who signs in with
 * Google lands back on /booking/new rather than on a generic dashboard. A
 * brand-new account has no roles yet, and /dashboard would only tell them to go
 * and choose some, so they go straight to /onboarding — which is where the
 * password signup flow already sends them.
 */
export function loginWithGoogle(): void {
  const requested =
    typeof window !== "undefined"
      ? safeInternalPath(new URLSearchParams(window.location.search).get("callbackUrl"))
      : null;
  void signIn("google", { callbackUrl: requested ?? "/dashboard" });
}

/** Sign out everywhere: clear the Auth.js cookie and the local store. */
export async function logout(): Promise<void> {
  useStore.getState().logout();
  await signOut({ redirect: false });
}
