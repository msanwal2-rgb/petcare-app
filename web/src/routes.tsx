import { createBrowserRouter } from "react-router";
import { AppShell } from "./App";
import { RequireAuth } from "./components/RequireAuth";
import { Moved } from "./components/Moved";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import NotFoundPage from "./pages/NotFoundPage";
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
  OnboardingPage,
  DashboardPage,
  PetNewPage,
  PetDetailPage,
  SearchPage,
  CaretakerDetailPage,
  BookingNewPage,
  BookingDetailPage,
  CaretakerProfilePage,
  VetSearchPage,
  VetDetailPage,
  AppointmentNewPage,
  AppointmentDetailPage,
  VetProfilePage,
  StorePage,
  ProductPage,
  CartPage,
  CheckoutPage,
  OrdersPage,
  OrderDetailPage,
  OpsOrdersPage,
  PetHealthPage,
  SupportPage,
  AdoptPage,
  AdoptionListingPage,
  AdoptionApplicationPage,
  ShelterPage,
  ShelterProfilePage,
  PlusPage,
  MembershipPage,
  AdminOverviewPage,
  AdminUsersPage,
  AdminUserDetailPage,
  AdminProfessionalsPage,
  AdminPaymentsPage,
  AdminSubscriptionsPage,
  AdminAuditPage,
  AdminSettingsPage,
} from "./lazyPages";


/**
 * The route tree — the reference project's `app/` directory, path for path.
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
 * security regression. The server re-checks every one of them regardless.
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

      // ── The auth flows ──
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

      // ── The dashboard ──
      // One role-aware page. The owner's pets, bookings, visits and orders are
      // all sections of it, as in the reference — there is no separate list
      // page for any of them.
      {
        path: "dashboard",
        element: (
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        ),
      },
      {
        // Before `dashboard/pets/:id`, so "new" is not matched as an id.
        path: "dashboard/pets/new",
        element: (
          <RequireAuth>
            <PetNewPage />
          </RequireAuth>
        ),
      },
      {
        path: "dashboard/pets/:id",
        element: (
          <RequireAuth>
            <PetDetailPage />
          </RequireAuth>
        ),
      },
      {
        path: "dashboard/caretaker-profile",
        element: (
          <RequireAuth>
            <CaretakerProfilePage />
          </RequireAuth>
        ),
      },
      {
        path: "dashboard/vet-profile",
        element: (
          <RequireAuth>
            <VetProfilePage />
          </RequireAuth>
        ),
      },
      {
        // Store operations. The page asks the API and renders "operations
        // only" on a 403 — the guard here is only that you are signed in.
        path: "dashboard/orders",
        element: (
          <RequireAuth>
            <OpsOrdersPage />
          </RequireAuth>
        ),
      },

      // ── Find care ──
      //
      // Search and the caretaker profile are unguarded: browsing the
      // marketplace is what brings people to it, and both serve only public
      // projections. Booking is where an account becomes necessary.
      { path: "search", element: <SearchPage /> },
      { path: "caretaker/:id", element: <CaretakerDetailPage /> },
      {
        // Before `booking/:id`, so "new" is not matched as a booking id.
        path: "booking/new",
        element: (
          <RequireAuth>
            <BookingNewPage />
          </RequireAuth>
        ),
      },
      {
        path: "booking/:id",
        element: (
          <RequireAuth>
            <BookingDetailPage />
          </RequireAuth>
        ),
      },

      // ── Find a vet ──
      //
      // Search and the clinic profile are unguarded, for the same reason the
      // caretaker equivalents are: an owner looking for a vet at eleven at
      // night should not have to sign up first. Booking is guarded.
      { path: "vets", element: <VetSearchPage /> },
      {
        // Static, so it outranks `vets/:id` — "book" is never read as a vet id.
        path: "vets/book",
        element: (
          <RequireAuth>
            <AppointmentNewPage />
          </RequireAuth>
        ),
      },
      { path: "vets/:id", element: <VetDetailPage /> },
      {
        path: "appointments/:id",
        element: (
          <RequireAuth>
            <AppointmentDetailPage />
          </RequireAuth>
        ),
      },

      // ── The store ──
      //
      // The shelves, a product and the cart are unguarded: browsing and
      // filling a basket need no account, and the cart lives in localStorage.
      // Checkout is where an account becomes necessary, because the server's
      // quote — the only price that counts — is signed-in only.
      //
      // The static `/store/*` paths are listed before `/store/:slug`. React
      // Router ranks static segments above dynamic ones regardless, but reading
      // them in this order makes it obvious a product slugged "cart" could
      // never shadow the cart.
      { path: "store", element: <StorePage /> },
      { path: "store/cart", element: <CartPage /> },
      {
        path: "store/checkout",
        element: (
          <RequireAuth>
            <CheckoutPage />
          </RequireAuth>
        ),
      },
      {
        path: "store/orders",
        element: (
          <RequireAuth>
            <OrdersPage />
          </RequireAuth>
        ),
      },
      {
        path: "store/orders/:id",
        element: (
          <RequireAuth>
            <OrderDetailPage />
          </RequireAuth>
        ),
      },
      { path: "store/:slug", element: <ProductPage /> },

      // ── Content ──
      { path: "pet-health", element: <PetHealthPage /> },
      { path: "support", element: <SupportPage /> },

      // ── Leash Plus (M7) ──
      // The marketing page is public — signed out it offers "Sign in to join".
      // The membership page is the reference's /account/*, behind the guard.
      { path: "plus", element: <PlusPage /> },
      {
        path: "account/membership",
        element: (
          <RequireAuth>
            <MembershipPage />
          </RequireAuth>
        ),
      },

      // ── Retired URLs ──
      // Earlier builds of this app used these. Each redirects to where its
      // content lives now, so no bookmark or emailed link 404s.
      { path: "dashboard/pets", element: <Moved to="/dashboard" /> },
      { path: "dashboard/bookings", element: <Moved to="/dashboard" /> },
      { path: "dashboard/appointments", element: <Moved to="/dashboard" /> },
      { path: "vet/:id", element: <Moved to="/vets/:id" /> },
      { path: "appointment/new", element: <Moved to="/vets/book" /> },
      { path: "appointment/:id", element: <Moved to="/appointments/:id" /> },

      // ── Adoption (M10) ──
      // The directory, an animal and the shelter pages are public; an
      // application page asks for a session itself, as the reference's did.
      { path: "adopt", element: <AdoptPage /> },
      { path: "adopt/:id", element: <AdoptionListingPage /> },
      { path: "adoptions/:id", element: <AdoptionApplicationPage /> },
      { path: "shelters/:id", element: <ShelterPage /> },
      {
        path: "dashboard/shelter-profile",
        element: (
          <RequireAuth>
            <ShelterProfilePage />
          </RequireAuth>
        ),
      },

      // ── The admin console (M9) ──
      // The guard only asks for a session. Which sections a member of staff
      // sees is AdminShell's courtesy; what they may do is every endpoint's
      // own check (REQUIREMENTS.md D1).
      { path: "dashboard/admin", element: <RequireAuth><AdminOverviewPage /></RequireAuth> },
      { path: "dashboard/admin/users", element: <RequireAuth><AdminUsersPage /></RequireAuth> },
      { path: "dashboard/admin/users/:id", element: <RequireAuth><AdminUserDetailPage /></RequireAuth> },
      { path: "dashboard/admin/professionals", element: <RequireAuth><AdminProfessionalsPage /></RequireAuth> },
      { path: "dashboard/admin/payments", element: <RequireAuth><AdminPaymentsPage /></RequireAuth> },
      { path: "dashboard/admin/subscriptions", element: <RequireAuth><AdminSubscriptionsPage /></RequireAuth> },
      { path: "dashboard/admin/audit", element: <RequireAuth><AdminAuditPage /></RequireAuth> },
      { path: "dashboard/admin/settings", element: <RequireAuth><AdminSettingsPage /></RequireAuth> },

      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
