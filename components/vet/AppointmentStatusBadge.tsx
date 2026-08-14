import type { AppointmentStatus } from "@/types";
import { APPOINTMENT_STATUS_LABELS } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

const TONE: Record<AppointmentStatus, StatusTone> = {
  requested: "pending",
  confirmed: "active",
  in_progress: "progress",
  completed: "done",
  declined: "failed",
  cancelled: "muted",
};

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      tone={TONE[status]}
      label={APPOINTMENT_STATUS_LABELS[status]}
      className={className}
    />
  );
}
