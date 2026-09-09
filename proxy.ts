/**
 * Route protection (Next.js 16 renamed Middleware → Proxy). Uses the edge-safe
 * auth config (no DB/bcrypt) to check the session JWT and redirect
 * unauthenticated users to /login. The matcher scopes this to private areas;
 * public pages (/, /search, /caretaker/*) and auth endpoints are untouched.
 *
 * This is an optimistic check only — the real authorization is enforced in the
 * API route handlers, which re-verify the session server-side.
 */

import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

// NextAuth's `auth` handler runs the `authorized` callback to decide access.
export default auth;

export const config = {
  // Pages only. /api is deliberately absent: the route handlers resolve the
  // session themselves, the assistant endpoint answers signed-out callers on
  // purpose, and the Stripe webhook must reach us unauthenticated so its own
  // signature check can be the gate.
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/booking/:path*",
    "/account/:path*",
  ],
};
