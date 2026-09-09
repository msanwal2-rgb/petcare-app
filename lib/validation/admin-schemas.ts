/**
 * Zod schemas for the administration endpoints.
 *
 * Kept beside the main schemas rather than inside them: these describe an
 * internal console, they change on a different rhythm from the public API, and
 * keeping the split visible makes "is this input reachable by a customer?" a
 * question you answer by looking at the import.
 */

import { z } from "zod";
import { STAFF_ROLES } from "@/lib/server/access";
import { userRole } from "./schemas";

/** Query strings arrive as strings; coerce, then constrain. */
const intish = z.coerce.number().int().min(0);
const boolish = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

export const staffRole = z.enum(STAFF_ROLES);
export const accountStatus = z.enum(["active", "suspended", "deleted"]);

export const adminUserQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  role: userRole.optional(),
  staffRole: staffRole.optional(),
  status: accountStatus.optional(),
  verified: boolish.optional(),
  authMethod: z.enum(["password", "google"]).optional(),
  sort: z.enum(["newest", "oldest", "name", "recent_login"]).optional(),
  limit: intish.max(100).optional(),
  offset: intish.optional(),
});
export type AdminUserQuery = z.infer<typeof adminUserQuerySchema>;

/**
 * One action per request rather than a free-form patch.
 *
 * A PATCH that accepts `{ status, roles, verified }` in any combination has to
 * be reasoned about as a set of combinations; a discriminated union has one
 * shape per thing an admin can actually decide to do, and each carries exactly
 * the context that action needs — which is why `suspend` can demand a reason
 * and the others can't accidentally accept one.
 */
export const adminUserActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), verified: z.boolean() }),
  z.object({
    action: z.literal("suspend"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({ action: z.literal("reactivate") }),
  z.object({ action: z.literal("sign_out") }),
  z.object({ action: z.literal("set_roles"), roles: z.array(userRole).max(3) }),
  z.object({
    action: z.literal("set_staff_roles"),
    staffRoles: z.array(staffRole).max(STAFF_ROLES.length),
  }),
]);
export type AdminUserAction = z.infer<typeof adminUserActionSchema>;

export const auditQuerySchema = z.object({
  actorUserId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  targetType: z.string().trim().min(1).optional(),
  targetId: z.string().trim().min(1).optional(),
  limit: intish.max(200).optional(),
  offset: intish.optional(),
});
export type AuditQueryBody = z.infer<typeof auditQuerySchema>;

export const settingsPatchSchema = z
  .object({
    signupsOpen: z.boolean(),
    maintenanceBanner: z.string().max(300),
    demoLoginVisible: z.boolean(),
    freeShippingThresholdCents: z.number().int().min(0).max(1_000_000),
  })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const backgroundCheckSchema = z.object({
  status: z.enum(["verified", "pending", "none"]),
  note: z.string().trim().max(500).optional(),
});

/* ── Finance ───────────────────────────────────────────────────── */

export const paymentStatus = z.enum([
  "unpaid",
  "pending",
  "requires_action",
  "processing",
  "authorized",
  "paid",
  "partially_refunded",
  "refunded",
  "failed",
  "disputed",
]);

export const adminPaymentQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: paymentStatus.optional(),
  kind: z.enum(["order", "subscription_invoice"]).optional(),
  userId: z.string().trim().min(1).optional(),
  limit: intish.max(100).optional(),
  offset: intish.optional(),
});
export type AdminPaymentQuery = z.infer<typeof adminPaymentQuerySchema>;

export const refundRequestSchema = z.object({
  /** Omitted means "everything still refundable". */
  amountCents: z.number().int().positive().optional(),
  reason: z
    .enum(["requested_by_customer", "duplicate", "fraudulent", "order_cancelled"])
    .optional(),
  note: z.string().trim().max(500).optional(),
});

export const subscriptionStatus = z.enum([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "canceled",
]);

export const adminSubscriptionQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  status: subscriptionStatus.optional(),
  limit: intish.max(100).optional(),
  offset: intish.optional(),
});
export type AdminSubscriptionQuery = z.infer<typeof adminSubscriptionQuerySchema>;

export const subscriptionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), immediately: z.boolean().optional() }),
  z.object({
    action: z.literal("extend_grace"),
    days: z.number().int().min(1).max(60),
  }),
]);

export const adminProfessionalQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: z.enum(["caretaker", "vet"]).optional(),
  status: z.enum(["verified", "pending", "none"]).optional(),
  limit: intish.max(100).optional(),
  offset: intish.optional(),
});
export type AdminProfessionalQuery = z.infer<typeof adminProfessionalQuerySchema>;

export const verificationSchema = z.object({
  kind: z.enum(["caretaker", "vet"]),
  status: z.enum(["verified", "pending", "none"]),
  note: z.string().trim().max(500).optional(),
});
