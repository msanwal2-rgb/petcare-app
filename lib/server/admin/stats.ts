/**
 * The admin overview.
 *
 * Every figure is a count the database can do itself. Nothing here loads rows
 * to count them in JavaScript, because this page is the first thing a staff
 * member opens and the last thing anyone will tolerate being slow.
 *
 * Date maths is string comparison: timestamps are stored as ISO-8601, which
 * sorts chronologically, so "created in the last seven days" is an indexed
 * `gte` against a computed string rather than a cast.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import type { AdminStats } from "@/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** Fold `groupBy` output into the `{ status: count }` shape the UI renders. */
function tally(rows: { status: string; _count: { _all: number } }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function getAdminStats(
  now: Date = new Date(),
  db: PrismaClient = defaultPrisma
): Promise<AdminStats> {
  const sevenDaysAgo = daysAgo(now, 7);
  const thirtyDaysAgo = daysAgo(now, 30);

  const [
    totalUsers,
    newLast7Days,
    newLast30Days,
    suspended,
    unverified,
    staff,
    bookingsTotal,
    bookingsByStatus,
    appointmentsTotal,
    appointmentsByStatus,
    ordersTotal,
    ordersByStatus,
    grossCents,
    awaitingFulfilment,
    activeProducts,
    outOfStock,
    conversations,
    assistantMessages,
  ] = await Promise.all([
    db.user.count({ where: { status: { not: "deleted" } } }),
    db.user.count({ where: { createdAt: { gte: sevenDaysAgo }, status: { not: "deleted" } } }),
    db.user.count({ where: { createdAt: { gte: thirtyDaysAgo }, status: { not: "deleted" } } }),
    db.user.count({ where: { status: "suspended" } }),
    db.user.count({ where: { verified: false, status: "active" } }),
    db.user.count({ where: { NOT: { staffRoles: { isEmpty: true } } } }),

    db.booking.count(),
    db.booking.groupBy({ by: ["status"], _count: { _all: true } }),

    db.vetAppointment.count(),
    db.vetAppointment.groupBy({ by: ["status"], _count: { _all: true } }),

    db.order.count(),
    db.order.groupBy({ by: ["status"], _count: { _all: true } }),
    // Gross merchandise value excludes the money that came back: a refunded or
    // cancelled order is not revenue, and showing it as such flatters the number
    // in exactly the direction nobody should be flattering it.
    db.order.aggregate({
      _sum: { totalCents: true },
      where: { status: { notIn: ["cancelled", "refunded", "pending_payment"] } },
    }),
    db.order.count({
      where: { status: { notIn: ["delivered", "cancelled", "refunded", "pending_payment"] } },
    }),

    db.product.count({ where: { active: true } }),
    db.product.count({ where: { active: true, stockQty: 0 } }),

    db.assistantConversation.count(),
    db.assistantMessage.count({ where: { role: "user", createdAt: { gte: sevenDaysAgo } } }),
  ]);

  return {
    users: {
      total: totalUsers,
      newLast7Days,
      newLast30Days,
      suspended,
      unverified,
      staff,
    },
    bookings: { total: bookingsTotal, byStatus: tally(bookingsByStatus) },
    appointments: { total: appointmentsTotal, byStatus: tally(appointmentsByStatus) },
    orders: {
      total: ordersTotal,
      grossCents: grossCents._sum.totalCents ?? 0,
      byStatus: tally(ordersByStatus),
      awaitingFulfilment,
    },
    catalog: { active: activeProducts, outOfStock },
    assistant: { conversations, messagesLast7Days: assistantMessages },
  };
}
