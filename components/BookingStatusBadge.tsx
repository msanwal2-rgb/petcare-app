import type { BookingStatus } from "@/types";
import { STATUS_LABELS } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "./ui/StatusBadge";

/** Every status is visually distinct so dashboards read at a glance (brief §6). */
const TONE: Record<BookingStatus, StatusTone> = {
  requested: "pending",
  accepted: "active",
  in_progress: "progress",
  completed: "done",
  declined: "failed",
  cancelled: "muted",
};

export function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      tone={TONE[status]}
      label={STATUS_LABELS[status]}
      className={className}
    />
  );
}
