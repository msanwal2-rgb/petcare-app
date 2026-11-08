import { cn } from "@/lib/utils";
import { TONE_DOT } from "@/lib/statusTone";

/**
 * One badge for every status in the app — booking, vet appointment, order.
 *
 * Callers map their own status union to a `tone` rather than to a colour, so
 * "waiting on someone" looks the same whether it's a booking request or an
 * unpaid order, and adding a status to any domain is a one-line change here.
 */
export type StatusTone =
  | "pending" // waiting on someone else to act
  | "active" // agreed and upcoming
  | "progress" // happening right now
  | "done" // finished successfully
  | "failed" // rejected or errored
  | "muted"; // withdrawn, cancelled, inert

const STYLES: Record<StatusTone, string> = {
  pending: "bg-marigold/15 text-[#946412] border-marigold/40",
  active: "bg-ink/10 text-ink border-ink/25",
  progress: "bg-[#2F6F5E]/12 text-[#215144] border-[#2F6F5E]/35",
  done: "bg-mist/50 text-ink border-mist",
  failed: "bg-leash/12 text-[#a83c27] border-leash/30",
  muted: "bg-charcoal/8 text-charcoal/70 border-charcoal/15",
};

export function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        STYLES[tone],
        className
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "progress" && "animate-pulse"
        )}
        style={{ backgroundColor: TONE_DOT[tone] }}
        aria-hidden
      />
      {label}
    </span>
  );
}
