import { Link, useParams, useSearchParams } from "react-router";
import { useState } from "react";
import { toast } from "sonner";
import { cancelOrder, getOrder, syncPayment } from "@/api/orders";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { OrderTracking } from "@/components/store/OrderTracking";
import { OrderStatusBadge } from "@/components/store/OrderStatusBadge";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { formatCents, formatDate } from "@/lib/utils";
import { canCustomerCancel } from "@/lib/delivery";

/**
 * One order — the reference's `app/store/orders/[id]/page.tsx`.
 *
 * One addition: an order left at `pending_payment` (the checkout's 502 path —
 * the order exists, starting its payment failed) offers "Retry payment".
 * Until M7 brings a card form there is no other way to settle it.
 */
export default function OrderDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const [retrying, setRetrying] = useState(false);
  const { currentUser, hasHydrated } = useSession();
  const [cancelling, setCancelling] = useState(false);

  /**
   * Arriving straight from the payment step. The browser knowing the card went
   * through is not the same as the server knowing — that arrives on a webhook,
   * which can lag by seconds. So the first fetch after paying asks the server
   * to reconcile with the provider first, and the page shows the settled state
   * rather than "awaiting payment" to somebody who has just paid.
   */
  const [justPaid] = useState(() => searchParams.get("paid") === "1");

  const { data: order, loading, reload } = useAsync(async () => {
    if (justPaid) {
      try {
        return await syncPayment(id);
      } catch {
        // The webhook may still land; fall through to a plain read.
      }
    }
    return getOrder(id).catch(() => null);
  }, [id, justPaid]);

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-24 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to track this order." />;

  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Order not found"
          description="It may have been placed on another account."
          actionLabel="Your orders"
          actionHref="/store/orders"
        />
      </div>
    );
  }

  async function retryPayment() {
    setRetrying(true);
    try {
      await syncPayment(id);
      toast.success("Payment received", { description: "We'll start picking your order." });
      reload();
    } catch (e) {
      toast.error("Still couldn't take the payment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setRetrying(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await cancelOrder(id);
      toast.success("Order cancelled", {
        description: "Anything already charged has been returned.",
      });
      reload();
    } catch (e) {
      toast.error("Couldn't cancel that order", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Link
        to="/store/orders"
        className="text-sm text-charcoal/60 underline-offset-2 hover:text-ink hover:underline"
      >
        ← All orders
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-leash">
            Order {order.id}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {order.items.length} item{order.items.length === 1 ? "" : "s"} ·{" "}
            {formatCents(order.totalCents)}
          </h1>
          <p className="mt-1 text-sm text-charcoal/70">
            Placed {formatDate(order.placedAt)}
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <Reveal className="mt-8">
        <OrderTracking order={order} />
      </Reveal>

      <Reveal className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <Panel title="What's in this order">
          <ul className="space-y-4">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-center gap-3">
                <Link
                  to={`/store/${item.slug}`}
                  className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-fog"
                >
                  <img
                    src={item.imageUrl}
                    alt=""
                    width={56}
                    height={56}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">
                    {item.brand}
                  </p>
                  <Link
                    to={`/store/${item.slug}`}
                    className="block truncate text-sm text-ink hover:underline"
                  >
                    {item.name}
                  </Link>
                  <p className="font-mono text-xs text-charcoal/55">
                    {item.quantity} × {formatCents(item.unitPriceCents)}
                  </p>
                </div>
                <p className="font-mono text-sm text-ink">
                  {formatCents(item.lineTotalCents)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        <div>
          <Panel title="Payment">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Subtotal</dt>
                <dd className="font-mono text-ink">
                  {formatCents(order.subtotalCents)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Shipping</dt>
                <dd className="font-mono text-ink">
                  {order.shippingCents === 0
                    ? "Free"
                    : formatCents(order.shippingCents)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-charcoal/65">Tax</dt>
                <dd className="font-mono text-ink">{formatCents(order.taxCents)}</dd>
              </div>
              <div className="flex justify-between border-t border-mist pt-2 font-semibold text-ink">
                <dt>Total</dt>
                <dd className="font-mono">{formatCents(order.totalCents)}</dd>
              </div>
            </dl>
            <p className="mt-3 border-t border-mist pt-3 font-mono text-[11px] text-charcoal/50">
              {order.paymentStatus} · {order.paymentRef ?? "no reference"}
            </p>
          </Panel>

          {order.status === "pending_payment" && (
            <Button
              variant="cta"
              className="mt-4 w-full"
              disabled={retrying}
              onClick={retryPayment}
            >
              {retrying ? "Trying again…" : "Retry payment"}
            </Button>
          )}

          {canCustomerCancel(order.status) && (
            <Button
              variant="outline"
              className="mt-4 w-full"
              disabled={cancelling}
              onClick={cancel}
            >
              {cancelling ? "Cancelling…" : "Cancel order"}
            </Button>
          )}
        </div>
      </Reveal>
    </div>
  );
}
