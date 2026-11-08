import type { User } from "@/types";
import { ApiError } from "@/api/_client";
import * as authApi from "@/api/auth";
import { getCurrentUser } from "@/api/users";
import { useSession } from "@/store/session";
import { DEMO_PASSWORD } from "./demo";

/**
 * The client side of authentication.
 *
 * This replaces the reference project's `lib/auth/session-client.ts`, which
 * wrapped Auth.js's `signIn`/`signOut`. Those are gone; the API owns the
 * session cookie now, so signing in is an ordinary POST and the only client
 * state is a cache of the current user.
 *
 * Two behaviours from the old file are deliberately *not* carried over:
 *
 *  - **The full document reload after sign-in.** That existed because Next's
 *    App Router cached the middleware's redirect to /login against a guarded
 *    route, and `router.push` afterwards replayed the stale redirect. React
 *    Router has no such cache — the guard is a component that re-reads the
 *    store — so navigation stays client-side and sign-in no longer costs a
 *    page load.
 *  - **`callbackUrl` parsing at every call site.** It is read once, by the
 *    route guard that set it.
 */

/**
 * Only same-origin paths.
 *
 * `callbackUrl` comes off the query string, so treating it as a destination
 * without this check is an open redirect — and an open redirect on the far side
 * of a sign-in is worth more than usual, because the victim arrives at the
 * attacker's page having just authenticated. The server applies the same check
 * on the OAuth round trip; this is the client half.
 */
export function safeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("//")) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.includes("\\")) return null;
  return raw;
}

/** Where to go after signing in, honouring `?callbackUrl=` when it is safe. */
export function destinationAfterAuth(search: string, fallback: string): string {
  return safeInternalPath(new URLSearchParams(search).get("callbackUrl")) ?? fallback;
}

/**
 * Pull the authenticated user from the server and push it into the store.
 *
 * A 401 is the ordinary signed-out answer, not an error worth surfacing: the
 * app calls this on every load, including for visitors who have never had an
 * account.
 */
export async function refreshSessionUser(): Promise<User | null> {
  let user: User | null = null;

  try {
    user = await getCurrentUser();
  } catch (error) {
    if (!(error instanceof ApiError)) {
      // A network failure, not a signed-out session. Treated the same way —
      // there is nothing the app can do differently — but worth not swallowing
      // silently while developing.
      console.warn("Could not reach /api/v1/me", error);
    }
  }

  const store = useSession.getState();
  store.setUser(user);
  store._setHydrated();

  return user;
}

/** Email and password sign-in. Throws with a message fit to show the user. */
export async function loginWithPassword(email: string, password: string): Promise<User> {
  const { user } = await authApi.login(email.trim(), password);

  // The cookie is already set by the response; the store is the client's cache
  // of who it belongs to.
  useSession.getState().setUser(user);
  useSession.getState()._setHydrated();

  return user;
}

/**
 * A guest finishing their account from the emailed link (STATUS §3-G). The
 * server activates it and sets the cookie; this caches who it belongs to.
 */
export async function completeAccountSetup(token: string, password: string): Promise<User> {
  const { user } = await authApi.setPassword(token, password);
  useSession.getState().setUser(user);
  useSession.getState()._setHydrated();
  return user;
}

/** One-tap demo login, using the shared demo password. */
export function loginAsDemo(email: string): Promise<User> {
  return loginWithPassword(email, DEMO_PASSWORD);
}

/** Sign out everywhere: clear the cookie server-side, then the local cache. */
export async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } finally {
    // Cleared even if the request failed. A client that thinks it is signed in
    // when it is not shows a dashboard full of 401s; the other way round it
    // shows a login page, which is recoverable.
    useSession.getState().logout();
  }
}

/**
 * Start the Google OAuth flow.
 *
 * A full navigation, deliberately: the endpoint answers with a 302 to Google's
 * consent screen, and only the browser can follow that.
 */
export function loginWithGoogle(callbackUrl?: string): void {
  window.location.assign(authApi.googleSignInUrl(callbackUrl));
}

/**
 * What the API's `?error=` codes mean, spelled out.
 *
 * The OAuth failures come back as a redirect to /login with a code, because a
 * redirect cannot carry a response body. Spelling them out matters: the default
 * is a bare code in the URL and a page that looks like nothing happened.
 */
export const SIGN_IN_ERRORS: Record<string, string> = {
  AccountExists:
    "An account with that email already exists. Sign in with your password, then link Google from your account settings.",
  EmailUnverified:
    "Google hasn't verified that email address, so we can't use it to sign you in.",
  OAuthAccountNotLinked: "That Google account isn't linked to a Leash account yet.",
  OAuthCallback: "Google sign-in didn't complete. Please try again.",
  FinishSetup:
    "You've booked with us as a guest. Set a password from the link we emailed you — or use “Forgot your password?” to get a new one.",
};
