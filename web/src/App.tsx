import { Outlet, ScrollRestoration } from "react-router";
import { SessionSync } from "./components/SessionSync";
import { SiteHeader } from "./components/SiteHeader";
import { MaintenanceBanner } from "./components/MaintenanceBanner";
import { SiteFooter } from "./components/SiteFooter";
import { PageTransition } from "./components/PageTransition";
import { ToastProvider } from "./components/ToastProvider";

/**
 * The app shell — what `app/layout.tsx` was.
 *
 * Everything here is mounted once and survives navigation, which is the point:
 * `SessionSync` asks /me exactly once per page load rather than once per route,
 * and the toaster keeps its queue across a redirect (so "Welcome back" fires on
 * /login and is still on screen when /dashboard renders).
 *
 * `PageTransition` sits inside <main> and is keyed on the pathname, so it
 * re-runs per route while the chrome around it does not.
 *
 * `ScrollRestoration` does what Next.js did without being asked: a new page
 * starts at the top, Back returns to where you were, and a `#hash` link
 * (the footer's `/pet-health#emergencies`) scrolls to its target.
 */
export function AppShell() {
  return (
    <div className="flex min-h-full flex-col bg-fog text-charcoal">
      <SessionSync />
      <ScrollRestoration />
      <SiteHeader />
      <MaintenanceBanner />

      <main className="flex flex-1 flex-col">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      <SiteFooter />
      <ToastProvider />
    </div>
  );
}
