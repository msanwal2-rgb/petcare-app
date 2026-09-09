/**
 * Administration console client. See ./orders.ts for the conventions this file
 * follows: one exported function per endpoint, each preceded by the method and
 * path it wraps, and nothing but `fetch` plumbing.
 *
 * Every one of these answers 403 for a signed-in user without the right staff
 * role, and the pages read that 403 as "explain, don't error" — the same idiom
 * /dashboard/orders has always used.
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
import type { SystemSettings } from "@/lib/server/settings";

/** GET /api/admin/stats -> AdminStats */
export async function getAdminStats(): Promise<AdminStats> {
  return getJson<AdminStats>("/api/admin/stats");
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
  offset?: number;
}

/** GET /api/admin/users -> AdminUserPage */
export async function searchAdminUsers(
  filters: AdminUserFilters = {}
): Promise<AdminUserPage> {
  return getJson<AdminUserPage>(
    `/api/admin/users${qs({
      q: filters.q,
      role: filters.role,
      staffRole: filters.staffRole,
      status: filters.status,
      verified: filters.verified,
      authMethod: filters.authMethod,
      sort: filters.sort,
      limit: filters.limit,
      offset: filters.offset,
    })}`
  );
}

/** GET /api/admin/users/:id -> AdminUserDetail */
export async function getAdminUser(id: string): Promise<AdminUserDetail> {
  return getJson<AdminUserDetail>(`/api/admin/users/${id}`);
}

/* ── Account actions ───────────────────────────────────────────── */

/** PATCH /api/admin/users/:id -> User */
export async function setUserVerified(id: string, verified: boolean): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, { action: "verify", verified });
}

/** PATCH /api/admin/users/:id -> User */
export async function suspendUser(id: string, reason: string): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, { action: "suspend", reason });
}

/** PATCH /api/admin/users/:id -> User */
export async function reactivateUser(id: string): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, { action: "reactivate" });
}

/** PATCH /api/admin/users/:id -> User — invalidates every session they hold. */
export async function signOutUser(id: string): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, { action: "sign_out" });
}

/** PATCH /api/admin/users/:id -> User */
export async function setUserRoles(id: string, roles: UserRole[]): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, { action: "set_roles", roles });
}

/** PATCH /api/admin/users/:id -> User — admin only. */
export async function setStaffRoles(
  id: string,
  staffRoles: StaffRole[]
): Promise<User> {
  return patchJson<User>(`/api/admin/users/${id}`, {
    action: "set_staff_roles",
    staffRoles,
  });
}

/** DELETE /api/admin/users/:id -> User — soft delete, admin only. */
export async function deleteUser(id: string): Promise<void> {
  return deleteJson(`/api/admin/users/${id}`);
}

/* ── Audit and settings ────────────────────────────────────────── */

export interface AuditFilters {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  items: AdminAuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /api/admin/audit -> AuditPage — admin only. */
export async function getAuditLog(filters: AuditFilters = {}): Promise<AuditPage> {
  return getJson<AuditPage>(`/api/admin/audit${qs({ ...filters })}`);
}

/** GET /api/admin/settings -> SystemSettings — admin only. */
export async function getAdminSettings(): Promise<SystemSettings> {
  return getJson<SystemSettings>("/api/admin/settings");
}

/** PATCH /api/admin/settings -> SystemSettings — admin only. */
export async function updateAdminSettings(
  patch: Partial<SystemSettings>
): Promise<SystemSettings> {
  return patchJson<SystemSettings>("/api/admin/settings", patch);
}

/* ── Finance ───────────────────────────────────────────────────── */

export interface AdminPaymentFilters {
  q?: string;
  status?: PaymentStatus;
  kind?: "order" | "subscription_invoice";
  userId?: string;
  limit?: number;
  offset?: number;
}

/** GET /api/admin/payments -> AdminPaymentPage — finance only. */
export async function searchPayments(
  filters: AdminPaymentFilters = {}
): Promise<AdminPaymentPage> {
  return getJson<AdminPaymentPage>(`/api/admin/payments${qs({ ...filters })}`);
}

/** POST /api/admin/payments/:id/refund -> { refundId, amountCents } */
export async function refundPayment(
  id: string,
  input: { amountCents?: number; reason?: string; note?: string } = {}
): Promise<{ refundId: string; amountCents: number }> {
  return postJson<{ refundId: string; amountCents: number }>(
    `/api/admin/payments/${id}/refund`,
    input
  );
}

export interface AdminSubscriptionFilters {
  q?: string;
  status?: SubscriptionStatus;
  limit?: number;
  offset?: number;
}

/** GET /api/admin/subscriptions -> AdminSubscriptionPage — finance only. */
export async function searchSubscriptions(
  filters: AdminSubscriptionFilters = {}
): Promise<AdminSubscriptionPage> {
  return getJson<AdminSubscriptionPage>(
    `/api/admin/subscriptions${qs({ ...filters })}`
  );
}

/** PATCH /api/admin/subscriptions/:id -> { ok } — cancels at period end. */
export async function cancelSubscription(
  id: string,
  immediately = false
): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/api/admin/subscriptions/${id}`, {
    action: "cancel",
    immediately,
  });
}

/** PATCH /api/admin/subscriptions/:id -> { ok } — more time before benefits stop. */
export async function extendGrace(id: string, days: number): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/api/admin/subscriptions/${id}`, {
    action: "extend_grace",
    days,
  });
}

/* ── Professional verification ─────────────────────────────────── */

export interface AdminProfessionalFilters {
  q?: string;
  kind?: "caretaker" | "vet" | "shelter";
  status?: VerificationStatus;
  limit?: number;
  offset?: number;
}

/** GET /api/admin/professionals -> AdminProfessionalPage — support. */
export async function searchProfessionals(
  filters: AdminProfessionalFilters = {}
): Promise<AdminProfessionalPage> {
  return getJson<AdminProfessionalPage>(
    `/api/admin/professionals${qs({ ...filters })}`
  );
}

/** PATCH /api/admin/professionals/:id -> { ok } */
export async function setVerification(
  id: string,
  kind: "caretaker" | "vet" | "shelter",
  status: VerificationStatus,
  note?: string
): Promise<{ ok: boolean }> {
  return patchJson<{ ok: boolean }>(`/api/admin/professionals/${id}`, {
    kind,
    status,
    note,
  });
}
