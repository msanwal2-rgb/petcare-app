import { lazy } from "react";

/**
 * Every page but the front door (home, login, signup, 404) is its own chunk,
 * so a visitor landing on the home page does not download the store, the vet
 * screens or the admin console. The shell suspends around its outlet while a
 * chunk loads (App.tsx). Kept out of routes.tsx so that file exports only the
 * router.
 */
export const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
export const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
export const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage"));
export const GuestRequestedPage = lazy(() => import("./pages/GuestRequestedPage"));
export const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
export const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
export const DashboardPage = lazy(() => import("./pages/DashboardPage"));
export const PetNewPage = lazy(() => import("./pages/PetNewPage"));
export const PetDetailPage = lazy(() => import("./pages/PetDetailPage"));
export const SearchPage = lazy(() => import("./pages/SearchPage"));
export const CaretakerDetailPage = lazy(() => import("./pages/CaretakerDetailPage"));
export const BookingNewPage = lazy(() => import("./pages/BookingNewPage"));
export const BookingDetailPage = lazy(() => import("./pages/BookingDetailPage"));
export const CaretakerProfilePage = lazy(() => import("./pages/CaretakerProfilePage"));
export const VetSearchPage = lazy(() => import("./pages/VetSearchPage"));
export const VetDetailPage = lazy(() => import("./pages/VetDetailPage"));
export const AppointmentNewPage = lazy(() => import("./pages/AppointmentNewPage"));
export const AppointmentDetailPage = lazy(() => import("./pages/AppointmentDetailPage"));
export const VetProfilePage = lazy(() => import("./pages/VetProfilePage"));
export const StorePage = lazy(() => import("./pages/StorePage"));
export const ProductPage = lazy(() => import("./pages/ProductPage"));
export const CartPage = lazy(() => import("./pages/CartPage"));
export const CheckoutPage = lazy(() => import("./pages/CheckoutPage"));
export const OrdersPage = lazy(() => import("./pages/OrdersPage"));
export const OrderDetailPage = lazy(() => import("./pages/OrderDetailPage"));
export const OpsOrdersPage = lazy(() => import("./pages/OpsOrdersPage"));
export const PetHealthPage = lazy(() => import("./pages/PetHealthPage"));
export const SupportPage = lazy(() => import("./pages/SupportPage"));
export const AdoptPage = lazy(() => import("./pages/AdoptPage"));
export const AdoptionListingPage = lazy(() => import("./pages/AdoptionListingPage"));
export const AdoptionApplicationPage = lazy(() => import("./pages/AdoptionApplicationPage"));
export const ShelterPage = lazy(() => import("./pages/ShelterPage"));
export const ShelterProfilePage = lazy(() => import("./pages/ShelterProfilePage"));
export const PlusPage = lazy(() => import("./pages/PlusPage"));
export const MembershipPage = lazy(() => import("./pages/MembershipPage"));
export const AdminOverviewPage = lazy(() => import("./pages/admin/AdminOverviewPage"));
export const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage"));
export const AdminUserDetailPage = lazy(() => import("./pages/admin/AdminUserDetailPage"));
export const AdminProfessionalsPage = lazy(() => import("./pages/admin/AdminProfessionalsPage"));
export const AdminPaymentsPage = lazy(() => import("./pages/admin/AdminPaymentsPage"));
export const AdminSubscriptionsPage = lazy(() => import("./pages/admin/AdminSubscriptionsPage"));
export const AdminAuditPage = lazy(() => import("./pages/admin/AdminAuditPage"));
export const AdminSettingsPage = lazy(() => import("./pages/admin/AdminSettingsPage"));
