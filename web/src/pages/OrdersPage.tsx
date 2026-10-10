import { Link } from "react-router";
import { useState } from "react";
import type { Order } from "@/types";
import { listMyOrders } from "@/api/orders";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { Button } from "@/components/ui/Button";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { BagIcon, ChevronRightIcon } from "@/components/ui/icons";
import { formatCents, formatDate } from "@/lib/utils";

/**
 * Order history — the reference's `app/store/orders/page.tsx`. The list is a
 * cursor page, newest first; "Show more" appears only past the first page.
 */
export default function OrdersPage() {
  const { currentUser, hasHydrated } = useSession();
  const { data: first, loading } = useAsync(
    () => (currentUser ? listMyOrders({ limit: 20 }) : Promise.resolve(null)),
    [currentUser?.id]
  );
  const [more, setMore] = useState<{ items: Order[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const orders = first ? [...first.items, ...(more?.items ?? [])] : [];
  const cursor = more ? more.cursor : (first?.nextCursor ?? null);

  async function showMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listMyOrders({ limit: 20, cursor });
      setMore({ items: [...(more?.items ?? []), ...page.items], cursor: page.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
        <Skeleton className="mt-3 h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to see your orders." />;

  if ((orders ?? []).length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          icon={<BagIcon width={40} height={40} />}
          title="No orders yet"
          description="Food, treats and supplements, delivered and tracked to your door."
          actionLabel="Browse the store"
          actionHref="/store"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your orders</h1>

      <div className="mt-6 space-y-3">
        {(orders ?? []).map((order) => {
          const latest = order.events.at(-1);
          return (
            <Link
              key={order.id}
              to={`/store/orders/${order.id}`}
              className="group block rounded-2xl border border-mist bg-white p-5 transition-colors hover:border-ink/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-charcoal/50">
                    {order.id} · {formatDate(order.placedAt)}
                  </p>
                  <p className="mt-1 font-medium text-ink">
                    {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                    {formatCents(order.totalCents)}
                  </p>
                </div>
                <OrderStatusBadge status={order.status} />
              </div>

              <div className="mt-4 flex items-center gap-2">
                {order.items.slice(0, 4).map((item) => (
                  <span
                    key={item.id}
                    className="relative h-12 w-12 overflow-hidden rounded-lg bg-fog"
                  >
<img
                      src={item.imageUrl}
                      alt=""
                      width={48}
                      height={48}
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </span>
                ))}
                {order.items.length > 4 && (
                  <span className="font-mono text-xs text-charcoal/50">
                    +{order.items.length - 4}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-mist pt-3">
                <p className="text-sm text-charcoal/70">
                  {latest?.label}
                  {latest?.location && (
                    <span className="text-charcoal/50"> · {latest.location}</span>
                  )}
                </p>
                <span className="flex items-center gap-1 text-sm font-medium text-ink">
                  Track
                  <ChevronRightIcon
                    width={15}
                    height={15}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {cursor && (
        <div className="mt-6 text-center">
          <Button variant="outline" onClick={showMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </div>
  );
}
