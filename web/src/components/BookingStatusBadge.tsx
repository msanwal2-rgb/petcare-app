import type { BookingStatus } from "@/types";
import { BOOKING_STATUS_TONE, STATUS_LABELS } from "@/lib/utils";
import { StatusBadge } from "./ui/StatusBadge";

/**
 * Every status is visually distinct so dashboards read at a glance (brief §6).
 * The tone map lives in lib/utils beside the labels, so nothing else needs its
 * own copy.
 */
export function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      tone={BOOKING_STATUS_TONE[status]}
      label={STATUS_LABELS[status]}
      className={className}
    />
  );
}
