import { motion } from "framer-motion";
import type { Order, OrderStatus } from "@/types";
import { ProgressLeash } from "@/components/ui/ProgressLeash";
import { CheckIcon, HomeIcon, PackageIcon, TruckIcon } from "@/components/ui/icons";
import { JOURNEY } from "@/lib/delivery";
import { ORDER_STATUS_LABELS, cn, formatDateTime } from "@/lib/utils";

const JOURNEY_LABELS = ["Paid", "Picking", "Packed", "Shipped", "On the van", "Delivered"];

const STEP_ICON: Partial<Record<OrderStatus, typeof CheckIcon>> = {
  paid: CheckIcon,
  processing: PackageIcon,
  packed: PackageIcon,
  shipped: TruckIcon,
  out_for_delivery: TruckIcon,
  delivered: HomeIcon,
};

/**
 * The journey from the shelf to the recipient's door.
 *
 * Two readings of the same data: the leash for where the order is right now,
 * and a timeline of what has actually happened, timestamped and placed. The
 * leash answers "how far along?", the timeline "what happened, and when?".
 *
 * The timeline is rendered in the order the API returns it, which is time and
 * then lifecycle position — the server sorts it, so that a fulfilment run that
 * stamps four stages with one instant still reads packed-before-shipped.
 */
export function OrderTracking({ order }: { order: Order }) {
  const journeyIndex = JOURNEY.indexOf(order.status);
  const finished = order.status === "delivered";

  return (
    <div>
      {order.status === "pending_payment" ? (
        <p className="mb-8 rounded-2xl border border-marigold/40 bg-marigold/10 px-4 py-3 text-sm text-[#946412]">
          We're waiting for your payment to clear. Your items are held for you
          in the meantime.
        </p>
      ) : journeyIndex >= 0 ? (
        <ProgressLeash
          steps={JOURNEY_LABELS}
          activeIndex={journeyIndex}
          label="Delivery stage"
          className="mb-8"
        />
      ) : (
        <p
          className={cn(
            "mb-8 rounded-2xl border px-4 py-3 text-sm",
            order.status === "refunded"
              ? "border-mist bg-white text-charcoal/75"
              : "border-charcoal/15 bg-charcoal/[0.04] text-charcoal/75",
          )}
        >
          {order.status === "refunded"
            ? "This order was refunded. The payment has been returned to you."
            : "This order was cancelled. Anything you paid has been refunded and nothing was shipped."}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_auto] sm:items-start">
        <div>
          <h2 className="text-sm font-semibold text-ink">Tracking history</h2>
          <ol className="relative mt-4">
            {order.events.map((event, i) => {
              const Icon = STEP_ICON[event.status] ?? CheckIcon;
              const isLatest = i === order.events.length - 1;
              return (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.25 }}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {i < order.events.length - 1 && (
                    <span
                      className="absolute left-[15px] top-8 h-full w-px border-l-2 border-dashed border-mist"
                      aria-hidden
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2",
                      isLatest ? "border-leash bg-leash text-white" : "border-mist bg-white text-ink",
                    )}
                  >
                    <Icon width={15} height={15} />
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <p className={cn("text-sm", isLatest ? "font-semibold text-ink" : "font-medium text-charcoal")}>
                      {event.label}
                    </p>
                    {event.description && (
                      <p className="mt-0.5 text-sm text-charcoal/70">{event.description}</p>
                    )}
                    <p className="mt-1 font-mono text-xs text-charcoal/50">
                      {formatDateTime(event.occurredAt)}
                      {event.location && ` · ${event.location}`}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </div>

        <div className="rounded-2xl border border-mist bg-white p-5 sm:w-64">
          <p className="text-xs uppercase tracking-wide text-charcoal/50">
            {finished ? "Delivered" : "Estimated delivery"}
          </p>
          <p className="mt-1 font-medium text-ink">
            {finished && order.deliveredAt
              ? formatDateTime(order.deliveredAt)
              : order.estimatedDeliveryAt
                ? formatDateTime(order.estimatedDeliveryAt)
                : "To be confirmed"}
          </p>

          <dl className="mt-4 space-y-2 border-t border-mist pt-4 text-sm">
            <div>
              <dt className="text-xs text-charcoal/55">Status</dt>
              <dd className="text-ink">{ORDER_STATUS_LABELS[order.status]}</dd>
            </div>
            {order.carrier && (
              <div>
                <dt className="text-xs text-charcoal/55">Carrier</dt>
                <dd className="text-ink">{order.carrier}</dd>
              </div>
            )}
            {order.trackingNumber && (
              <div>
                <dt className="text-xs text-charcoal/55">Tracking number</dt>
                <dd className="font-mono text-xs text-ink">{order.trackingNumber}</dd>
              </div>
            )}
          </dl>

          <div className="mt-4 border-t border-mist pt-4">
            <p className="text-xs text-charcoal/55">Delivering to</p>
            <address className="mt-1 text-sm not-italic text-charcoal/85">
              {order.shippingAddress.name}
              <br />
              {order.shippingAddress.line1}
              {order.shippingAddress.line2 && (
                <>
                  <br />
                  {order.shippingAddress.line2}
                </>
              )}
              <br />
              {order.shippingAddress.city}, {order.shippingAddress.state}{" "}
              {order.shippingAddress.postalCode}
            </address>
            {order.deliveryInstructions && (
              <p className="mt-2 text-xs text-charcoal/65">“{order.deliveryInstructions}”</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
