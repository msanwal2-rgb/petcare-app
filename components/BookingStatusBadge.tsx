import type { BookingStatus } from "@/types";
import { STATUS_LABELS, cn } from "@/lib/utils";

/** Color-coded per BookingStatus (brief §6). Every status is visually
 *  distinct so dashboards read at a glance. Colors stay within the palette. */
const STYLES: Record<BookingStatus, string> = {
  requested: "bg-marigold/15 text-[#946412] border-marigold/40",
  accepted: "bg-ink/10 text-ink border-ink/25",
  in_progress: "bg-[#2F6F5E]/12 text-[#215144] border-[#2F6F5E]/35",
  completed: "bg-mist/50 text-ink border-mist",
  declined: "bg-leash/12 text-[#a83c27] border-leash/30",
  cancelled: "bg-charcoal/8 text-charcoal/70 border-charcoal/15",
};

const DOT: Record<BookingStatus, string> = {
  requested: "#F2A93B",
  accepted: "#1B3B36",
  in_progress: "#2F6F5E",
  completed: "#7d938a",
  declined: "#E85C41",
  cancelled: "#9aa0a2",
};

export function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        STYLES[status],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "in_progress" && "animate-pulse"
        )}
        style={{ backgroundColor: DOT[status] }}
        aria-hidden
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
