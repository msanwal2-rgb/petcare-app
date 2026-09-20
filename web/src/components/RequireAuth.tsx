import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useSession } from "@/store/session";
import { Skeleton } from "./ui/Skeleton";

/**
 * The route guard.
 *
 * This is what `proxy.ts` used to be. The reference project checked the session
 * JWT in Next.js middleware, at the edge, before the page rendered — and that
 * arrangement caused the one bug the old sign-in flow was built around: a
 * guarded route visited (or prefetched) while signed out cached the redirect to
 * /login, and the router replayed it afterwards.
 *
 * A component cannot cache anything, so the workaround goes with it. The
 * trade-off is that the guard now runs in the browser, which would be a
 * security regression if it were the boundary — it is not. Every endpoint
 * re-checks the session server-side (REQUIREMENTS.md section 2.6), so this is
 * only about not showing someone a dashboard that would answer 401 to every
 * request it makes.
 *
 * `hasHydrated` is why there is a skeleton rather than an immediate redirect:
 * on a fresh page load the store is empty until /me answers, and redirecting on
 * that would bounce a signed-in user to /login on every refresh.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { currentUser, hasHydrated } = useSession();
  const location = useLocation();

  if (!hasHydrated) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-64 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) {
    // Carry where they were trying to go, so signing in returns them here
    // rather than dumping them on the dashboard. Someone three steps into
    // checkout should not lose their place because their session expired.
    const target = `${location.pathname}${location.search}`;

    return (
      <Navigate to={`/login?callbackUrl=${encodeURIComponent(target)}`} replace />
    );
  }

  return <>{children}</>;
}
