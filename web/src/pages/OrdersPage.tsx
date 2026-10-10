import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Order } from "@/types";
import { listMyOrders } from "@/api/orders";
import { EmptyState } from "@/components/EmptyState";
import { OrderStatusBadge } from "@/components/store/OrderTracking";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { PackageIcon } from "@/components/ui/icons";
import { formatCents, formatDate } from "@/lib/utils";

/**
 * The customer's orders, newest first. "Show more" rather than page numbers —
 * the API is cursor-paginated, and a history is scrolled, not navigated.
 *
 * Each row shows what was bought as it was *at purchase* — the line items are
 * snapshots (REQUIREMENTS.md S11), so a product renamed or repriced since
 * still reads as what this customer actually paid for.
 */
export default function OrdersPage() {
  const [items, setItems] = useState<Order[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    listMyOrders({ limit: 10 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => setItems([]));
  }, []);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listMyOrders({ cursor, limit: 10 });
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Your orders</h1>
      <p className="mt-1 text-sm text-charcoal/60">Track a parcel, or cancel before it ships.</p>

      {items === null && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      )}

      {items?.length === 0 && (
        <EmptyState
          className="mt-8"
          icon={<PackageIcon width={40} height={40} />}
          title="No orders yet"
          description="Food, treats, and the therapeutic diets your vet prescribed — tracked to your door."
          actionLabel="Browse the store"
          actionHref="/store"
        />
      )}

      {items && items.length > 0 && (
        <>
          <ul className="mt-8 space-y-3">
            {items.map((order) => (
              <li key={order.id}>
                <Link
                  to={`/store/orders/${order.id}`}
                  className="block rounded-2xl border border-mist bg-white p-4 transition-colors hover:border-ink"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-ink">
                        {formatDate(order.placedAt)}
                        <span className="text-charcoal/50"> · {formatCents(order.totalCents)}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-charcoal/50">{order.id}</p>
                    </div>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <p className="mt-2 truncate text-sm text-charcoal/70">
                    {order.items.map((i) => `${i.quantity} × ${i.name}`).join(" · ")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          {cursor && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
