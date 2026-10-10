import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { Order } from "@/types";
import { cancelOrder, getOrder, syncPayment } from "@/api/orders";
import { ApiError } from "@/api/_client";
import { OrderStatusBadge, OrderTracking } from "@/components/store/OrderTracking";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { CheckIcon } from "@/components/ui/icons";
import { canCustomerCancel } from "@/lib/delivery";
import { formatCents, formatDateTime } from "@/lib/utils";

/**
 * One order: where it is, what happened, what was in it, and — while it is
 * still ours to stop — a Cancel button.
 *
 * The button is a courtesy mirror of the server's window (`lib/delivery.ts`).
 * The server is the authority; if the parcel shipped between this page loading
 * and the click, the 409 says so and the page reloads to show why.
 *
 * Opened by its customer or by store operations; anyone else gets the same 404
 * an order that does not exist gets.
 */
export default function OrderDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const justPlaced = params.get("placed") === "1";

  const [order, setOrder] = useState<Order | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getOrder(id).then(setOrder).catch(() => setOrder(null));
  }, [id]);

  useEffect(load, [load]);

  if (order === undefined) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (order === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Order not found</h1>
        <p className="mt-2 text-sm text-charcoal/60">It may not exist, or it may not be yours.</p>
        <ButtonLink to="/store/orders" variant="outline" className="mt-6">
          Your orders
        </ButtonLink>
      </div>
    );
  }

  async function cancel() {
    if (!window.confirm("Cancel this order? Anything you paid will be refunded.")) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await cancelOrder(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this order");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function retryPayment() {
    setBusy(true);
    setError(null);
    try {
      await syncPayment(id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-12 sm:px-6">
      <Link to="/store/orders" className="text-sm text-charcoal/60 hover:text-ink">
        ← Your orders
      </Link>

      {justPlaced && order.status !== "pending_payment" && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#2F6F5E]/30 bg-[#2F6F5E]/8 p-4 text-sm text-[#215144]">
          <CheckIcon width={18} height={18} className="shrink-0" />
          Thanks — your order is placed and paid. We'll keep this page up to date as it moves.
        </div>
      )}

      <section className="rounded-2xl border border-mist bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Order {order.id}</h1>
            <p className="mt-1 text-sm text-charcoal/60">Placed {formatDateTime(order.placedAt)}</p>
          </div>
          <OrderStatusBadge status={order.status} />
        </div>

        {error && (
          <p role="alert" className="mt-5 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash">
            {error}
          </p>
        )}

        <div className="mt-8">
          <OrderTracking order={order} />
        </div>

        {(canCustomerCancel(order.status) || order.status === "pending_payment") && (
          <div className="mt-8 flex flex-wrap gap-3 border-t border-mist pt-5">
            {order.status === "pending_payment" && (
              <Button variant="cta" size="sm" onClick={retryPayment} disabled={busy}>
                Pay now
              </Button>
            )}
            {canCustomerCancel(order.status) && (
              <Button variant="ghost" size="sm" onClick={cancel} disabled={busy}>
                Cancel order
              </Button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-mist bg-white p-6">
        <h2 className="text-lg font-semibold text-ink">What's in it</h2>
        <ul className="mt-4 divide-y divide-mist">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-center gap-4 py-3">
              <img
                src={item.imageUrl}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-lg bg-fog object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-wide text-charcoal/45">{item.brand}</p>
                <Link to={`/store/${item.slug}`} className="block truncate text-sm text-ink hover:underline">
                  {item.name}
                </Link>
                <p className="font-mono text-xs text-charcoal/60">
                  {item.quantity} × {formatCents(item.unitPriceCents)}
                </p>
              </div>
              <p className="font-mono text-sm text-ink">{formatCents(item.lineTotalCents)}</p>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-mist pt-4 text-sm">
          <Row label="Subtotal" value={formatCents(order.subtotalCents)} />
          <Row label="Shipping" value={order.shippingCents === 0 ? "Free" : formatCents(order.shippingCents)} />
          <Row label="Tax" value={formatCents(order.taxCents)} />
          <div className="flex justify-between pt-2 text-base font-semibold text-ink">
            <dt>Total</dt>
            <dd className="font-mono">{formatCents(order.totalCents)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-charcoal/80">
      <dt>{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}
