import { Link } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import type { Order, OrderStatus } from "@/types";
import { listFulfilmentQueue, updateOrderStatus } from "@/api/orders";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { PackageIcon } from "@/components/ui/icons";
import { formatCents, formatDate } from "@/lib/utils";

/**
 * Fulfilment console.
 *
 * There is no warehouse behind this — advancing an order here is what moves it
 * along and writes the customer-visible tracking event. It's a simulation, and
 * the page says so, but every state change it makes is real. The fulfilment
 * job moves the same orders; if it got there first, the move is refused as a
 * concurrent change (409) and the queue reloads.
 *
 * Refunds are not here, as in the reference — they belong to the admin
 * console's payments screen (M9).
 */
/**
 * There is deliberately no `pending_payment` step here.
 *
 * It used to offer "Mark paid", which was harmless while the status was dead
 * code and is a hole now that it is real: it would let fulfilment staff mark an
 * unpaid order paid and ship it, bypassing the payment provider entirely. An
 * order becomes paid because money arrived, and nothing on this screen is
 * evidence of that. (Unpaid orders no longer reach this queue at all.)
 */
const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  paid: { to: "processing", label: "Start picking" },
  processing: { to: "packed", label: "Mark packed" },
  packed: { to: "shipped", label: "Hand to carrier" },
  shipped: { to: "out_for_delivery", label: "Out for delivery" },
  out_for_delivery: { to: "delivered", label: "Mark delivered" },
};

function trackingNumberFor(order: Order): string {
  // Deterministic from the order id so re-running never renumbers a parcel.
  const digits = order.id.replace(/\D/g, "").slice(-8).padStart(8, "0");
  return `LEASH-${digits.slice(0, 4)}-${digits.slice(4)}`;
}

export default function OpsOrdersPage() {
  const { currentUser, hasHydrated } = useSession();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const { data: orders, loading, reload } = useAsync(async () => {
    if (!currentUser) return [];
    try {
      // The API's largest page for this queue. It is oldest-first and only holds
      // orders still moving, so in practice this is all of it.
      return (await listFulfilmentQueue({ limit: 200 })).items;
    } catch (e) {
      // A 403 here just means "not ops" — render the explanation, not an error.
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return [];
      }
      throw e;
    }
  }, [currentUser?.id]);

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to view the fulfilment queue." />;

  if (denied) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Store operations only"
          description="This is where orders are picked, packed and shipped. Your account doesn't have fulfilment access."
          actionLabel="Back to dashboard"
          actionHref="/dashboard"
        />
      </div>
    );
  }

  const queue = orders ?? [];

  async function advance(order: Order) {
    const step = NEXT_STEP[order.status];
    if (!step) return;
    setBusyId(order.id);
    try {
      await updateOrderStatus(order.id, {
        status: step.to,
        location: `${order.shippingAddress.city}, ${order.shippingAddress.state}`,
        ...(step.to === "shipped"
          ? { carrier: "Leash Delivery", trackingNumber: trackingNumberFor(order) }
          : {}),
      });
      toast.success(`${order.id} → ${step.to.replace(/_/g, " ")}`);
      reload();
    } catch (e) {
      toast.error("Couldn't advance that order", {
        description: e instanceof Error ? e.message : undefined,
      });
      if (e instanceof ApiError && e.status === 409) reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        Store operations
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        Fulfilment queue
      </h1>
      <p className="mt-1 text-sm text-charcoal/70">
        Oldest first. Advancing an order writes the tracking event the customer
        sees — there&apos;s no warehouse behind this, so this console is the
        warehouse.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="In queue" value={String(queue.length)} />
        <Stat
          label="To pick"
          value={String(queue.filter((o) => o.status === "paid").length)}
        />
        <Stat
          label="In transit"
          value={String(
            queue.filter((o) =>
              ["shipped", "out_for_delivery"].includes(o.status)
            ).length
          )}
        />
        <Stat
          label="Value"
          value={formatCents(queue.reduce((s, o) => s + o.totalCents, 0))}
        />
      </div>

      {queue.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<PackageIcon width={40} height={40} />}
            title="Nothing waiting"
            description="Every order has been delivered, cancelled or refunded."
            actionLabel="Back to dashboard"
            actionHref="/dashboard"
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {queue.map((order) => {
            const step = NEXT_STEP[order.status];
            return (
              <div
                key={order.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/store/orders/${order.id}`}
                      className="font-mono text-sm font-medium text-ink hover:underline"
                    >
                      {order.id}
                    </Link>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <p className="mt-1 truncate text-sm text-charcoal/70">
                    {order.shippingAddress.name} · {order.shippingAddress.city},{" "}
                    {order.shippingAddress.state} ·{" "}
                    {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
                    {formatCents(order.totalCents)}
                  </p>
                  <p className="font-mono text-xs text-charcoal/50">
                    Placed {formatDate(order.placedAt)}
                    {order.trackingNumber && ` · ${order.trackingNumber}`}
                  </p>
                </div>

                {step && (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busyId === order.id}
                    onClick={() => advance(order)}
                  >
                    {step.label}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
