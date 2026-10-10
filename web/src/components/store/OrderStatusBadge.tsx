import type { OrderStatus } from "@/types";
import { ORDER_STATUS_LABELS } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

/**
 * Order status → badge tone. Refunded reads as "failed" deliberately: the
 * purchase did not happen as intended, even though the money came back.
 */
const TONE: Record<OrderStatus, StatusTone> = {
  pending_payment: "pending",
  paid: "active",
  processing: "progress",
  packed: "progress",
  shipped: "progress",
  out_for_delivery: "progress",
  delivered: "done",
  cancelled: "muted",
  refunded: "failed",
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      tone={TONE[status]}
      label={ORDER_STATUS_LABELS[status]}
      className={className}
    />
  );
}
