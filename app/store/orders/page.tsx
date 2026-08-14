"use client";

import Image from "next/image";
import Link from "next/link";
import { getMyOrders } from "@/lib/api/orders";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { BagIcon, ChevronRightIcon } from "@/components/ui/icons";
import { formatCents, formatDate } from "@/lib/utils";

export default function OrdersPage() {
  const { currentUser, hasHydrated } = useSession();
  const { data: orders, loading } = useAsync(
    () => (currentUser ? getMyOrders() : Promise.resolve([])),
    [currentUser?.id]
  );

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
              href={`/store/orders/${order.id}`}
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
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="48px"
                      className="object-cover"
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
    </div>
  );
}
