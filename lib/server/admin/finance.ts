/**
 * The finance side of the admin console: the payments ledger and the members.
 *
 * Reads follow the same Postgres-side filter-and-paginate shape as
 * `searchProducts` and the user list; writes go through the ledger in
 * ../payments/ledger so that refunding from here and refunding from a webhook
 * are the same operation.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { recordAdminAction } from "../audit";
import { requestRefund } from "../payments/ledger";
import { subscriptionProvider } from "../payments/subscription-provider";
import { nowIso } from "../ids";
import type {
  AdminPaymentPage,
  AdminPaymentRow,
  AdminSubscriptionPage,
  AdminSubscriptionRow,
  PaymentStatus,
  RefundStatus,
  SubscriptionStatus,
} from "@/types";
import type { AdminPaymentQuery, AdminSubscriptionQuery } from "@/lib/validation/admin-schemas";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/* ── Payments ──────────────────────────────────────────────────── */

function paymentWhere(params: AdminPaymentQuery): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.kind) where.kind = params.kind;
  if (params.userId) where.userId = params.userId;
  if (params.q) {
    const q = params.q.trim();
    where.OR = [
      { providerRef: { contains: q, mode: "insensitive" } },
      { orderId: q },
      { user: { email: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function searchPayments(
  params: AdminPaymentQuery = {},
  db: PrismaClient = defaultPrisma
): Promise<AdminPaymentPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;
  const where = paymentWhere(params);

  const [rows, total, sums] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, email: true } },
        refunds: { orderBy: { createdAt: "desc" } },
      },
    }),
    db.payment.count({ where }),
    // Captured minus returned, over the *filtered* set, so the number under a
    // filter describes what is on screen rather than the whole ledger.
    db.payment.aggregate({
      where: { ...where, status: { in: ["paid", "partially_refunded", "refunded"] } },
      _sum: { amountCents: true, amountRefundedCents: true },
    }),
  ]);

  const items: AdminPaymentRow[] = rows.map((p) => ({
    id: p.id,
    userId: p.userId,
    userName: p.user.name,
    userEmail: p.user.email,
    kind: p.kind,
    orderId: p.orderId,
    provider: p.provider,
    providerRef: p.providerRef,
    status: p.status as PaymentStatus,
    amountCents: p.amountCents,
    amountRefundedCents: p.amountRefundedCents,
    currency: p.currency,
    methodBrand: p.methodBrand,
    methodLast4: p.methodLast4,
    failureMessage: p.failureMessage,
    createdAt: p.createdAt,
    succeededAt: p.succeededAt,
    refunds: p.refunds.map((r) => ({
      id: r.id,
      amountCents: r.amountCents,
      status: r.status as RefundStatus,
      reason: r.reason,
      initiatedBy: r.initiatedBy,
      createdAt: r.createdAt,
      settledAt: r.settledAt,
    })),
  }));

  return {
    items,
    total,
    limit,
    offset,
    capturedCents: sums._sum.amountCents ?? 0,
    refundedCents: sums._sum.amountRefundedCents ?? 0,
  };
}

export type AdminRefundResult =
  | { ok: true; refundId: string; amountCents: number }
  | { ok: false; code: string; message: string };

/** Issue a refund from the console, recording who did it and why. */
export async function refundPayment(
  paymentId: string,
  input: { amountCents?: number; reason?: string; note?: string },
  actor: { uid: string; ip?: string },
  db: PrismaClient = defaultPrisma
): Promise<AdminRefundResult> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { user: { select: { email: true } } },
  });
  if (!payment) return { ok: false, code: "no_payment", message: "No such payment" };

  const result = await requestRefund(
    {
      paymentId,
      amountCents: input.amountCents,
      reason: (input.reason as "requested_by_customer") ?? "requested_by_customer",
      initiatedBy: actor.uid,
      note: input.note ?? "",
    },
    db
  );

  if (!result.ok) {
    const message =
      result.code === "exceeds_captured"
        ? `Only ${result.remainingCents} cents are still refundable`
        : result.code === "already_refunding"
          ? "A refund on this payment is already in flight"
          : result.code === "not_refundable"
            ? `A payment that is "${result.status}" cannot be refunded`
            : result.code === "provider_failed"
              ? result.message
              : "There is nothing to refund";
    return { ok: false, code: result.code, message };
  }

  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "payment.refund",
      targetType: "payment",
      targetId: paymentId,
      summary: `Refunded ${result.amountCents} cents to ${payment.user.email}`,
      metadata: {
        amountCents: result.amountCents,
        orderId: payment.orderId,
        reason: input.reason,
        note: input.note,
      },
      ip: actor.ip,
    },
    db
  );

  return result;
}

/* ── Subscriptions ─────────────────────────────────────────────── */

export async function searchSubscriptions(
  params: AdminSubscriptionQuery = {},
  db: PrismaClient = defaultPrisma
): Promise<AdminSubscriptionPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;

  const where: Prisma.SubscriptionWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.q
      ? {
          OR: [
            { providerRef: { contains: params.q, mode: "insensitive" as const } },
            { user: { email: { contains: params.q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [rows, total, live] = await Promise.all([
    db.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        user: { select: { id: true, name: true, email: true } },
        plan: true,
      },
    }),
    db.subscription.count({ where }),
    db.subscription.findMany({
      where: { status: { in: ["active", "trialing"] } },
      include: { plan: { select: { priceCents: true, interval: true } } },
    }),
  ]);

  // Monthly recurring revenue, normalised: an annual plan contributes a twelfth
  // of itself, so the figure means the same thing whatever is being sold.
  const mrrCents = live.reduce(
    (sum, s) =>
      sum +
      (s.plan.interval === "year"
        ? Math.round(s.plan.priceCents / 12)
        : s.plan.priceCents),
    0
  );

  const items: AdminSubscriptionRow[] = rows.map((s) => ({
    id: s.id,
    userId: s.userId,
    userName: s.user.name,
    userEmail: s.user.email,
    planName: s.plan.name,
    priceCents: s.plan.priceCents,
    status: s.status as SubscriptionStatus,
    providerRef: s.providerRef,
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    graceEndsAt: s.graceEndsAt,
    createdAt: s.createdAt,
  }));

  return { items, total, limit, offset, activeCount: live.length, mrrCents };
}

export type AdminSubscriptionResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "provider_failed"; message: string };

/**
 * Cancel a member's subscription on their behalf.
 *
 * At the period end by default — they paid for the month. `immediately` exists
 * for the support case where somebody wants out now and has been told what that
 * means.
 */
export async function adminCancelSubscription(
  id: string,
  opts: { immediately?: boolean },
  actor: { uid: string; ip?: string },
  db: PrismaClient = defaultPrisma
): Promise<AdminSubscriptionResult> {
  const sub = await db.subscription.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!sub) return { ok: false, code: "not_found", message: "No such subscription" };

  const provider = subscriptionProvider();
  if (provider) {
    try {
      await provider.setCancelAtPeriodEnd(sub.providerRef, true);
    } catch (e) {
      return {
        ok: false,
        code: "provider_failed",
        message: e instanceof Error ? e.message : "The provider refused",
      };
    }
  }

  await db.subscription.update({
    where: { id },
    data: {
      cancelAtPeriodEnd: true,
      ...(opts.immediately
        ? { status: "canceled", canceledAt: nowIso(), endedAt: nowIso() }
        : {}),
      updatedAt: nowIso(),
    },
  });

  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "subscription.cancel",
      targetType: "subscription",
      targetId: id,
      summary: `Cancelled ${sub.user.email}'s membership${opts.immediately ? " immediately" : " at period end"}`,
      metadata: { immediately: Boolean(opts.immediately) },
      ip: actor.ip,
    },
    db
  );
  return { ok: true };
}

/** Give a member in dunning more time before their benefits stop. */
export async function extendGrace(
  id: string,
  days: number,
  actor: { uid: string; ip?: string },
  db: PrismaClient = defaultPrisma
): Promise<AdminSubscriptionResult> {
  const sub = await db.subscription.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!sub) return { ok: false, code: "not_found", message: "No such subscription" };

  const from = sub.graceEndsAt ? Date.parse(sub.graceEndsAt) : Date.now();
  const graceEndsAt = new Date(
    Math.max(from, Date.now()) + days * 86_400_000
  ).toISOString();

  await db.subscription.update({
    where: { id },
    data: { graceEndsAt, updatedAt: nowIso() },
  });

  await recordAdminAction(
    {
      actorUserId: actor.uid,
      action: "subscription.grace_extend",
      targetType: "subscription",
      targetId: id,
      summary: `Extended ${sub.user.email}'s grace period by ${days} days`,
      metadata: { graceEndsAt },
      ip: actor.ip,
    },
    db
  );
  return { ok: true };
}
