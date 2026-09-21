import { createBrowserRouter } from "react-router";
import { AppShell } from "./App";
import { RequireAuth } from "./components/RequireAuth";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import ComingSoonPage from "./pages/ComingSoonPage";
import NotFoundPage from "./pages/NotFoundPage";

/**
 * The route tree.
 *
 * One layout route wrapping everything, which is what `app/layout.tsx` was: the
 * header, the maintenance banner, the footer, the toaster and the session sync
 * are mounted once and survive navigation.
 *
 * ── Guarded routes ──
 *
 * `RequireAuth` wraps the element rather than sitting in the tree as a layout
 * route, so a guarded route's own element is what the guard renders. This is the
 * replacement for `proxy.ts` and its matcher
 * (`/dashboard/*`, `/onboarding/*`, `/booking/*`, `/account/*`) — see
 * components/RequireAuth.tsx for why moving the check into the browser is not a
 * security regression.
 *
 * ── Why the auth pages are not guarded the other way ──
 *
 * /login and /signup stay reachable while signed in. Redirecting a signed-in
 * visitor away from them sounds tidy and breaks the case that matters: someone
 * whose session has gone stale in another tab, who needs to sign in again on a
 * page the store still thinks is authenticated.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },

      // ── M1: the auth flows ──
      { path: "login", element: <LoginPage /> },
      { path: "signup", element: <SignupPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "reset-password", element: <ResetPasswordPage /> },

      // Unguarded on purpose: the link arrives by email, and someone clicking
      // it from a phone they have never signed in on must still be able to
      // verify. The token is the credential.
      { path: "verify-email", element: <VerifyEmailPage /> },

      {
        path: "onboarding",
        element: (
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        ),
      },
      {
        path: "dashboard",
        element: (
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        ),
      },

      // ── Later milestones ──
      // Registered as named placeholders so the header's nav does not 404 on
      // its own links, and so the information architecture is visible now.
      {
        path: "search",
        element: (
          <ComingSoonPage
            milestone="M4 · caretakers"
            title="Caretaker search is on the way"
            description="Search, filtering and booking for walking, sitting, boarding and daycare arrive with M4."
          />
        ),
      },
      {
        path: "vets",
        element: (
          <ComingSoonPage
            milestone="M5 · vets"
            title="Vet care is on the way"
            description="Licensed vets, appointments and visit summaries that write into the health record arrive with M5."
          />
        ),
      },
      {
        path: "store",
        element: (
          <ComingSoonPage
            milestone="M6 · store"
            title="The store is on the way"
            description="Food, supplies and the prescription gate that unlocks Rx-only products arrive with M6."
          />
        ),
      },
      {
        path: "adopt",
        element: (
          <ComingSoonPage
            milestone="M10 · adoption"
            title="Adoption is on the way"
            description="Shelter listings, applications, and the health record that transfers with the animal arrive with M10."
          />
        ),
      },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
