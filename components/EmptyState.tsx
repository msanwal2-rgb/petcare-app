import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Reusable empty state (brief §6). Reads as an invitation to act, not a blank
 * void (§3). Provide an icon, a warm title, a next-step description, and a CTA.
 */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-mist bg-white/60 px-6 py-14 text-center",
        className
      )}
    >
      {icon && (
        <div className="animate-float mb-4 text-ink/70" aria-hidden>
          {icon}
        </div>
      )}
      <h3 className="text-lg text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-charcoal/70">{description}</p>
      {actionLabel && actionHref && (
        <ButtonLink href={actionHref} variant="cta" className="mt-5">
          {actionLabel}
        </ButtonLink>
      )}
    </div>
  );
}
