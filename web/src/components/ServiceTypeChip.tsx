import type { ServiceType } from "@/types";
import { SERVICE_LABELS, cn } from "@/lib/utils";

/**
 * A distinct colour per service type, carried by the dot rather than by a
 * filled background — four chips side by side stay readable and on-palette
 * instead of becoming a rainbow.
 */
const DOT: Record<ServiceType, string> = {
  walking: "#1B3B36", // ink
  sitting: "#F2A93B", // marigold
  boarding: "#2F6F5E", // deep sage
  daycare: "#C77D2E", // amber
};

export function ServiceTypeChip({
  service,
  size = "md",
}: {
  service: ServiceType;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-mist bg-white font-mono uppercase tracking-wide text-charcoal",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: DOT[service] }}
        aria-hidden
      />
      {SERVICE_LABELS[service]}
    </span>
  );
}
