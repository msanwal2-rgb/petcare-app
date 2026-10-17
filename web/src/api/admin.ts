/**
 * Administration console client — the reference's lib/api/admin.ts. One
 * function per endpoint, nothing but fetch plumbing.
 *
 * Every one of these answers 403 for a signed-in user without the right staff
 * role, and the pages read that 403 as "explain, don't error". Lists are
 * cursor pages (`nextCursor`) that also carry the `total` for the filter; the
 * reference paged by offset.
 */

import { deleteJson, getJson, patchJson, postJson, qs } from "./_client";
import type {
  AdminAuditEntry,
  AdminPaymentPage,
  AdminProfessionalPage,
  AdminStats,
  AdminSubscriptionPage,
  AdminUserDetail,
  AdminUserPage,
  PaymentStatus,
  StaffRole,
  SubscriptionStatus,
  User,
  UserRole,
  VerificationStatus,
} from "@/types";

/** The runtime settings an admin can change without a deploy. */
export interface SystemSettings {
  signupsOpen: boolean;
  maintenanceBanner: string;
  demoLoginVisible: boolean;
  freeShippingThresholdCents: number;
}

/** GET /admin/stats -> AdminStats — any staff. */
export function getAdminStats(): Promise<AdminStats> {
  return getJson<AdminStats>("/admin/stats");
}

export interface AdminUserFilters {
  q?: string;
  role?: UserRole;
  staffRole?: StaffRole;
  status?: "active" | "suspended" | "deleted";
  verified?: boolean;
  authMethod?: "password" | "google";
  sort?: "newest" | "oldest" | "name" | "recent_login";
  limit?: number;
  cursor?: string | null;
}

/** GET /admin/users -> AdminUserPage — support. */
export function searchAdminUsers(filters: AdminUserFilters = {}): Promise<AdminUserPage> {
  return getJson<AdminUserPage>(`/admin/users${qs({ ...filters })}`);
}

/** GET /admin/users/:id -> AdminUserDetail */
export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return getJson<AdminUserDetail>(`/admin/users/${id}`);
}

/* ── Account actions ───────────────────────────────────────────── */

/** PATCH /admin/users/:id -> User */
export function setUserVerified(id: string, verified: boolean): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "verify", verified });
}

/** PATCH /admin/users/:id -> User — also signs them out of every device. */
export function suspendUser(id: string, reason: string): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "suspend", reason });
}

/** PATCH /admin/users/:id -> User */
export function reactivateUser(id: string): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "reactivate" });
}

/** PATCH /admin/users/:id -> User — invalidates every session they hold. */
export function signOutUser(id: string): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "sign_out" });
}

/** PATCH /admin/users/:id -> User */
export function setUserRoles(id: string, roles: UserRole[]): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "set_roles", roles });
}

/** PATCH /admin/users/:id -> User — admin only. */
export function setStaffRoles(id: string, staffRoles: StaffRole[]): Promise<User> {
  return patchJson<User>(`/admin/users/${id}`, { action: "set_staff_roles", staffRoles });
}

/** DELETE /admin/users/:id -> User — soft delete, admin only. */
export function deleteUser(id: string): Promise<void> {
  return deleteJson(`/admin/users/${id}`);
}

/* ── Audit and settings ────────────────────────────────────────── */

export interface AuditFilters {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  cursor?: string | null;
}

export interface AuditPage {
  items: AdminAuditEntry[];
  nextCursor: string | null;
  total: number;
}

/** GET /admin/audit -> AuditPage — admin only. */
export function getAuditLog(filters: AuditFilters = {}): Promise<AuditPage> {
  return getJson<AuditPage>(`/admin/audit${qs({ ...filters })}`);
}

/** GET /admin/settings -> SystemSettings — admin only. */
export function getAdminSettings(): Promise<SystemSettings> {
  return getJson<SystemSettings>("/admin/settings");
}

/** PATCH /admin/settings -> SystemSettings — admin only. */
export function updateAdminSettings(patch: Partial<SystemSettings>): Promise<SystemSettings> {
  return patchJson<SystemSettings>("/admin/settings", patch);
}

/* ── Finance ───────────────────────────────────────────────────── */

export interface AdminPaymentFilters {
  q?: string;
  status?: PaymentStatus;
  kind?: "order" | "subscription_invoice";
  userId?: string;
  limit?: number;
  cursor?: string | null;
}

/** GET /admin/payments -> AdminPaymentPage — finance only. */
export function searchPayments(filters: AdminPaymentFilters = {}): Promise<AdminPaymentPage> {
  return getJson<AdminPaymentPage>(`/admin/payments${qs({ ...filters })}`);
}

/**
 * POST /admin/payments/:id/refund -> { refundId, amountCents, pending }.
 * `pending` means the provider did not confirm it yet and it will be retried.
 */
export function refundPayment(
  id: string,
  input: { amountCents?: number; reason?: string; note?: string } = {}
): Promise<{ refundId: string; amountCents: number; pending: boolean }> {
  return postJson<{ refundId: string; amountCents: number; pending: boolean }>(
    `/admin/payments/${id}/refund`,
    input
  );
}

export interface AdminSubscriptionFilters {
  q?: string;
  status?: SubscriptionStatus;
  limit?: number;
  cursor?: string | null;
}

/** GET /admin/subscriptions -> AdminSubscriptionPage — finance only. */
export function searchSubscriptions(
  filters: AdminSubscriptionFilters = {}
): Promise<AdminSubscriptionPage> {
  return getJson<AdminSubscriptionPage>(`/admin/subscriptions${qs({ ...filters })}`);
}

/** PATCH /admin/subscriptions/:id -> { ok } — at period end unless `immediately`. */
export function cancelSubscription(id: string, immediately = false): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/admin/subscriptions/${id}`, { action: "cancel", immediately });
}

/** PATCH /admin/subscriptions/:id -> { ok } — undo a scheduled cancellation. */
export function resumeSubscription(id: string): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/admin/subscriptions/${id}`, { action: "resume" });
}

/** PATCH /admin/subscriptions/:id -> { ok } — more time before benefits stop. */
export function extendGrace(id: string, days: number): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/admin/subscriptions/${id}`, { action: "extend_grace", days });
}

/* ── Professional verification ─────────────────────────────────── */

export interface AdminProfessionalFilters {
  q?: string;
  kind?: "caretaker" | "vet" | "shelter";
  status?: VerificationStatus;
  limit?: number;
  cursor?: string | null;
}

/** GET /admin/professionals -> AdminProfessionalPage — support. */
export function searchProfessionals(
  filters: AdminProfessionalFilters = {}
): Promise<AdminProfessionalPage> {
  return getJson<AdminProfessionalPage>(`/admin/professionals${qs({ ...filters })}`);
}

/** PATCH /admin/professionals/:id -> { ok } */
export function setVerification(
  id: string,
  kind: "caretaker" | "vet" | "shelter",
  status: VerificationStatus,
  note?: string
): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/admin/professionals/${id}`, { kind, status, note });
}
