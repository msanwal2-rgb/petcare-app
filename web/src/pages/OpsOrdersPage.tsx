import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Order, OrderStatus } from "@/types";
import { listFulfilmentQueue, updateOrderStatus } from "@/api/orders";
import { ApiError } from "@/api/_client";
import { EmptyState } from "@/components/EmptyState";
import { OrderStatusBadge } from "@/components/store/OrderTracking";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { PackageIcon } from "@/components/ui/icons";
import { JOURNEY } from "@/lib/delivery";
import { ORDER_STATUS_LABELS, formatCents, formatDateTime } from "@/lib/utils";

/**
 * The fulfilment queue — store operations only (REQUIREMENTS.md S16).
 *
 * Oldest first, because the order waiting longest is the one to pick next.
 * Unpaid checkouts are not here: an unpaid basket is not a parcel.
 *
 * Every button is one move along the journey, and every move writes the same
 * customer-visible timeline event the fulfilment job writes — the job and this
 * console are two hands on one lever. If the job moved an order while this page
 * was open, the move is refused as a concurrent change and the row refreshes;
 * nobody's click silently overwrites the other's.
 *
 * Staff can refund an order at any stage, including after delivery; a customer
 * can only cancel until it ships. That asymmetry is the transition table, not
 * this page — a refund here goes through the same server rules.
 */
export default function OpsOrdersPage() {
  const [items, setItems] = useState<Order[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listFulfilmentQueue({ limit: 50 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setForbidden(true);
        setItems([]);
      });
  }, []);

  useEffect(load, [load]);

  async function showMore() {
    if (!cursor) return;
    const page = await listFulfilmentQueue({ cursor, limit: 50 });
    setItems((current) => [...(current ?? []), ...page.items]);
    setCursor(page.nextCursor);
  }

  async function move(order: Order, status: OrderStatus) {
    setBusyId(order.id);
    setError(null);
    try {
      const updated = await updateOrderStatus(order.id, {
        status,
        location: `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
        ...(status === "shipped" ? { carrier: "Leash Delivery" } : {}),
      });
      setItems((current) =>
        (current ?? [])
          // Delivered and terminal orders leave the queue, as the server would.
          .map((o) => (o.id === updated.id ? updated : o))
          .filter((o) => !["delivered", "cancelled", "refunded"].includes(o.status)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? `${order.id}: ${err.message}` : "Could not move that order");
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Store operations only</h1>
        <p className="mt-2 text-sm text-charcoal/65">
          The fulfilment queue is for the team that picks and ships orders.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold text-ink">Fulfilment</h1>
      <p className="mt-1 text-sm text-charcoal/60">
        Paid orders on their way out, oldest first. Orders also advance on their own
        schedule — this is for moving one along by hand.
      </p>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash">
          {error}
        </p>
      )}

      {items === null && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      )}

      {items?.length === 0 && (
        <EmptyState
          className="mt-8"
          icon={<PackageIcon width={40} height={40} />}
          title="Nothing waiting"
          description="Every paid order has been delivered or closed."
        />
      )}

      {items && items.length > 0 && (
        <ul className="mt-8 space-y-3">
          {items.map((order) => {
            const at = JOURNEY.indexOf(order.status);
            const next = at >= 0 && at < JOURNEY.length - 1 ? JOURNEY[at + 1] : null;
            const shipped = ["shipped", "out_for_delivery", "delivered"].includes(order.status);
            const busy = busyId === order.id;

            return (
              <li key={order.id} className="rounded-2xl border border-mist bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/store/orders/${order.id}`} className="font-mono text-sm text-ink hover:underline">
                      {order.id}
                    </Link>
                    <p className="mt-0.5 text-sm text-charcoal/65">
                      {order.shippingAddress.name} · {order.shippingAddress.city}, {order.shippingAddress.state}
                      {" · "}
                      {formatCents(order.totalCents)}
                    </p>
                    <p className="mt-0.5 text-xs text-charcoal/50">Placed {formatDateTime(order.placedAt)}</p>
                  </div>
                  <OrderStatusBadge status={order.status} />
                </div>

                <p className="mt-2 truncate text-sm text-charcoal/70">
                  {order.items.map((i) => `${i.quantity} × ${i.name}`).join(" · ")}
                </p>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-mist pt-3">
                  {next && (
                    <Button size="sm" variant="cta" disabled={busy} onClick={() => move(order, next)}>
                      Mark {ORDER_STATUS_LABELS[next].toLowerCase()}
                    </Button>
                  )}
                  {!shipped && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => move(order, "cancelled")}>
                      Cancel
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => move(order, "refunded")}>
                    Refund
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cursor && (
        <div className="mt-8 text-center">
          <Button variant="outline" onClick={showMore}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
