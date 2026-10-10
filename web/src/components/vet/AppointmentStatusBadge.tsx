import type { AppointmentStatus } from "@/types";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONE } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/StatusBadge";

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  return (
    <StatusBadge
      tone={APPOINTMENT_STATUS_TONE[status]}
      label={APPOINTMENT_STATUS_LABELS[status]}
      className={className}
    />
  );
}
