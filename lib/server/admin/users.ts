/**
 * User administration — server logic.
 *
 * Search follows lib/server/products.ts rather than the caretaker and vet
 * searches: those filter a small seeded set in memory, which is fine for a
 * demo catalogue and wrong for a user table that only grows. Filtering,
 * counting and paging all happen in Postgres, and the page envelope is the same
 * `{ items, total, limit, offset }` the store already returns.
 *
 * Every mutation here takes the acting admin's id and records an audit entry,
 * because a privileged action nobody can attribute is indistinguishable from an
 * intrusion afterwards.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toUser } from "../serialize";
import { nowIso } from "../ids";
import { recordAdminAction } from "../audit";
import { isStaffRole, type StaffRole } from "../access";
import type {
  AccountStatus,
  AdminUserDetail,
  AdminUserSummary,
  AdminUserPage,
  UserRole,
} from "@/types";
import type { AdminUserQuery } from "@/lib/validation/admin-schemas";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const ORDER_BY: Record<string, Prisma.UserOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  name: [{ name: "asc" }],
  // Nulls last, so accounts that have actually signed in lead the list.
  recent_login: [{ lastLoginAt: { sort: "desc", nulls: "last" } }],
};

function whereFor(params: AdminUserQuery): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (params.status) where.status = params.status;
  if (params.role) where.roles = { has: params.role };
  if (params.staffRole) where.staffRoles = { has: params.staffRole };
  if (params.verified !== undefined) where.verified = params.verified;

  // "How did they get in?" — the question support actually asks when someone
  // says they can't sign in.
  if (params.authMethod === "google") where.googleId = { not: null };
  if (params.authMethod === "password") where.passwordHash = { not: null };

  if (params.q) {
    const q = params.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      // Exact on id: a support ticket quotes an id, and a `contains` on it
      // would make "u1" match u1, u10, u11 … which is never what was meant.
      { id: q },
    ];
  }
  return where;
}

/** Columns the list needs. Selected explicitly so `passwordHash` can't leak by accident. */
const SUMMARY_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  roles: true,
  staffRoles: true,
  status: true,
  verified: true,
  createdAt: true,
  lastLoginAt: true,
  addressCity: true,
  addressState: true,
  googleId: true,
  passwordHash: true,
} satisfies Prisma.UserSelect;

type SummaryRow = Prisma.UserGetPayload<{ select: typeof SUMMARY_SELECT }>;

function toSummary(u: SummaryRow): AdminUserSummary {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    roles: u.roles as UserRole[],
    staffRoles: u.staffRoles.filter(isStaffRole),
    status: u.status as AccountStatus,
    verified: u.verified,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    city: u.addressCity,
    state: u.addressState,
    // The presence of a credential, never the credential.
    authMethods: [
      ...(u.passwordHash ? (["password"] as const) : []),
      ...(u.googleId ? (["google"] as const) : []),
    ],
  };
}

export async function searchAdminUsers(
  params: AdminUserQuery = {},
  db: PrismaClient = defaultPrisma
): Promise<AdminUserPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;
  const where = whereFor(params);

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: ORDER_BY[params.sort ?? "newest"],
      take: limit,
      skip: offset,
      select: SUMMARY_SELECT,
    }),
    db.user.count({ where }),
  ]);

  return { items: rows.map(toSummary), total, limit, offset };
}

/**
 * Everything about one account, in one round trip.
 *
 * A support call is "what is going on with this person", and answering it from
 * six separate endpoints means six chances to show a half-loaded page.
 */
export async function getAdminUserDetail(
  id: string,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserDetail | null> {
  const row = await db.user.findUnique({
    where: { id },
    select: {
      ...SUMMARY_SELECT,
      phone: true,
      lat: true,
      lng: true,
      suspendedAt: true,
      suspendedReason: true,
      deletedAt: true,
      sessionsValidFrom: true,
    },
  });
  if (!row) return null;

  const [pets, bookings, appointments, orders, notifications, caretaker, vet] =
    await Promise.all([
      db.pet.count({ where: { ownerId: id } }),
      db.booking.count({ where: { ownerId: id } }),
      db.vetAppointment.count({ where: { ownerId: id } }),
      db.order.findMany({
        where: { userId: id },
        orderBy: { placedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          totalCents: true,
          placedAt: true,
        },
      }),
      db.notification.count({ where: { userId: id, readAt: null } }),
      db.caretakerProfile.findUnique({
        where: { userId: id },
        select: { id: true, backgroundCheckStatus: true, rating: true, reviewCount: true },
      }),
      db.vetProfile.findUnique({
        where: { userId: id },
        select: { id: true, clinicName: true, licenseNumber: true, licenseState: true },
      }),
    ]);

  return {
    ...toSummary(row),
    phone: row.phone,
    address: {
      city: row.addressCity,
      state: row.addressState,
      lat: row.lat,
      lng: row.lng,
    },
    suspendedAt: row.suspendedAt,
    suspendedReason: row.suspendedReason,
    deletedAt: row.deletedAt,
    sessionsValidFrom: row.sessionsValidFrom,
    counts: {
      pets,
      bookings,
      appointments,
      orders: orders.length,
      unreadNotifications: notifications,
    },
    recentOrders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      paymentStatus: o.paymentStatus,
      totalCents: o.totalCents,
      placedAt: o.placedAt,
    })),
    caretakerProfile: caretaker
      ? {
          id: caretaker.id,
          backgroundCheckStatus: caretaker.backgroundCheckStatus,
          rating: caretaker.rating,
          reviewCount: caretaker.reviewCount,
        }
      : null,
    vetProfile: vet
      ? {
          id: vet.id,
          clinicName: vet.clinicName,
          licenseNumber: vet.licenseNumber,
          licenseState: vet.licenseState,
        }
      : null,
  };
}

/* ── Mutations ─────────────────────────────────────────────────── */

export type AdminUserMutationResult =
  | { ok: true; user: ReturnType<typeof toUser> }
  | { ok: false; code: "not_found" | "self_staff_edit" | "last_admin" };

export interface ActingAdmin {
  uid: string;
  ip?: string;
}

/** Mark an account's email verified, or take that back. */
export async function setUserVerified(
  id: string,
  verified: boolean,
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const user = await db.user.update({ where: { id }, data: { verified } });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: verified ? "user.verify" : "user.unverify",
      targetType: "user",
      targetId: id,
      summary: `${verified ? "Verified" : "Un-verified"} ${existing.email}`,
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

/**
 * Suspend an account.
 *
 * `sessionsValidFrom` is bumped in the same write, so the suspension takes
 * effect on the suspended user's very next request rather than whenever their
 * JWT happens to expire — which, with a 30-day cookie, could be a month.
 */
export async function suspendUser(
  id: string,
  reason: string,
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const user = await db.user.update({
    where: { id },
    data: {
      status: "suspended",
      suspendedAt: nowIso(),
      suspendedReason: reason,
      sessionsValidFrom: nowIso(),
    },
  });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.suspend",
      targetType: "user",
      targetId: id,
      summary: `Suspended ${existing.email}`,
      metadata: { reason },
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

export async function reactivateUser(
  id: string,
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const user = await db.user.update({
    where: { id },
    data: { status: "active", suspendedAt: null, suspendedReason: "" },
  });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.reactivate",
      targetType: "user",
      targetId: id,
      summary: `Reactivated ${existing.email}`,
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

/** Invalidate every session this user holds, without suspending them. */
export async function forceSignOut(
  id: string,
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const user = await db.user.update({
    where: { id },
    data: { sessionsValidFrom: nowIso() },
  });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.sign_out",
      targetType: "user",
      targetId: id,
      summary: `Signed ${existing.email} out of every device`,
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

export async function setUserRoles(
  id: string,
  roles: UserRole[],
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const user = await db.user.update({ where: { id }, data: { roles } });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.roles_change",
      targetType: "user",
      targetId: id,
      summary: `Roles for ${existing.email}: ${existing.roles.join(", ") || "none"} → ${roles.join(", ") || "none"}`,
      metadata: { from: existing.roles, to: roles },
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

/**
 * Grant or revoke staff privileges.
 *
 * Two refusals, both about the same failure mode — an admin console that can
 * lock itself out or quietly promote its operator:
 *
 *  - **Nobody edits their own staff roles.** Otherwise "admin" is not a role,
 *    it is a starting point, and the audit trail records the promotion as
 *    routine.
 *  - **The last admin cannot be demoted.** Losing every admin means nobody can
 *    grant the role back, and recovery is a hand-written UPDATE against
 *    production.
 */
export async function setStaffRoles(
  id: string,
  staffRoles: StaffRole[],
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  if (id === actor.uid) return { ok: false, code: "self_staff_edit" };

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  const wasAdmin = existing.staffRoles.includes("admin");
  if (wasAdmin && !staffRoles.includes("admin")) {
    const admins = await db.user.count({
      where: { staffRoles: { has: "admin" }, status: "active" },
    });
    if (admins <= 1) return { ok: false, code: "last_admin" };
  }

  const user = await db.user.update({
    where: { id },
    data: {
      staffRoles,
      // Kept in step until the column is dropped, so a rollback to the previous
      // release still finds the fulfilment console reachable by the right people.
      isOps: staffRoles.includes("ops") || staffRoles.includes("admin"),
    },
  });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.staff_roles_change",
      targetType: "user",
      targetId: id,
      summary: `Staff roles for ${existing.email}: ${existing.staffRoles.join(", ") || "none"} → ${staffRoles.join(", ") || "none"}`,
      metadata: { from: existing.staffRoles, to: staffRoles },
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}

/**
 * Soft-delete: keep the row, scrub the person.
 *
 * A hard delete is not available, and the reason is structural rather than
 * squeamish. `OrderItem.product` is `onDelete: Restrict` while most other
 * relations cascade, so deleting a customer would either fail outright or take
 * their order history, their reviews and the other side of their bookings with
 * it — destroying financial records and other people's reputation data to
 * satisfy one request.
 *
 * So identity goes and the skeleton stays: the orders remain, attributed to a
 * numbered ghost.
 */
export async function softDeleteUser(
  id: string,
  actor: ActingAdmin,
  db: PrismaClient = defaultPrisma
): Promise<AdminUserMutationResult> {
  if (id === actor.uid) return { ok: false, code: "self_staff_edit" };

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return { ok: false, code: "not_found" };

  if (existing.staffRoles.includes("admin")) {
    const admins = await db.user.count({
      where: { staffRoles: { has: "admin" }, status: "active" },
    });
    if (admins <= 1) return { ok: false, code: "last_admin" };
  }

  const now = nowIso();
  const user = await db.user.update({
    where: { id },
    data: {
      status: "deleted",
      deletedAt: now,
      sessionsValidFrom: now,
      name: "Deleted account",
      // Keeps the unique constraint satisfiable and the address unrecoverable.
      email: `deleted+${id}@removed.invalid`,
      phone: "",
      avatarUrl: "",
      passwordHash: null,
      googleId: null,
      addressCity: "",
      addressState: "",
      lat: 0,
      lng: 0,
      roles: [],
      staffRoles: [],
      isOps: false,
    },
  });
  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "user.delete",
      targetType: "user",
      targetId: id,
      summary: `Deleted the account formerly at ${existing.email}`,
      ip: actor.ip,
    },
    db
  );
  return { ok: true, user: toUser(user) };
}
