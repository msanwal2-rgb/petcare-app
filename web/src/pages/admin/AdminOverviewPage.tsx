import { Link } from "react-router";
import { useState } from "react";
import { getAdminStats } from "@/api/admin";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { ApiError } from "@/api/_client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Panel, Stat } from "@/components/ui/Panel";
import { formatCents } from "@/lib/utils";

/**
 * The overview.
 *
 * Ordered by what someone opening this at the start of a shift actually needs
 * to know, which is not the same as what is easiest to count: anything that
 * needs a human — orders waiting to be picked, accounts suspended, products out
 * of stock — comes before the totals that only describe how big the place is.
 */

/** A row of "status: count", sorted biggest first so the shape is readable. */
function StatusBreakdown({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return <p className="text-sm text-charcoal/55">Nothing yet.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {entries.map(([status, count]) => (
        <li key={status} className="flex items-center justify-between gap-3 text-sm">
          <span className="capitalize text-charcoal/70">
            {status.replace(/_/g, " ")}
          </span>
          <span className="font-mono text-ink">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export default function AdminOverviewPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);

  const { data: stats, loading } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await getAdminStats();
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return null;
      }
      throw e;
    }
  }, [currentUser?.id]);

  return (
    <AdminShell
      title="Overview"
      lede="Where the platform stands right now."
      denied={denied}
      loading={loading}
    >
      {stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Orders to fulfil" value={String(stats.orders.awaitingFulfilment)} />
            <Stat label="Suspended accounts" value={String(stats.users.suspended)} />
            <Stat label="Out of stock" value={String(stats.catalog.outOfStock)} />
            <Stat label="Unverified emails" value={String(stats.users.unverified)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              title="People"
              action={
                <Link
                  to="/dashboard/admin/users"
                  className="text-xs text-charcoal/55 hover:text-ink hover:underline"
                >
                  Browse
                </Link>
              }
            >
              <ul className="space-y-1.5 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">Accounts</span>
                  <span className="font-mono text-ink">{stats.users.total}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">New this week</span>
                  <span className="font-mono text-ink">{stats.users.newLast7Days}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">New this month</span>
                  <span className="font-mono text-ink">{stats.users.newLast30Days}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">Staff</span>
                  <span className="font-mono text-ink">{stats.users.staff}</span>
                </li>
              </ul>
            </Panel>

            <Panel
              title="Store"
              action={
                <Link
                  to="/dashboard/orders"
                  className="text-xs text-charcoal/55 hover:text-ink hover:underline"
                >
                  Fulfilment
                </Link>
              }
            >
              <ul className="mb-3 space-y-1.5 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">Orders</span>
                  <span className="font-mono text-ink">{stats.orders.total}</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">Gross value</span>
                  <span className="font-mono text-ink">
                    {formatCents(stats.orders.grossCents)}
                  </span>
                </li>
                <li className="flex justify-between gap-3">
                  <span className="text-charcoal/70">Active products</span>
                  <span className="font-mono text-ink">{stats.catalog.active}</span>
                </li>
              </ul>
              <StatusBreakdown counts={stats.orders.byStatus} />
            </Panel>

            <Panel title={`Bookings · ${stats.bookings.total}`}>
              <StatusBreakdown counts={stats.bookings.byStatus} />
            </Panel>

            <Panel title={`Vet appointments · ${stats.appointments.total}`}>
              <StatusBreakdown counts={stats.appointments.byStatus} />
            </Panel>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
