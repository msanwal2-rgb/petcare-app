import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered white card with a small heading. The app's default container. */
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  /** Optional control rendered opposite the title. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-mist bg-white p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A single headline figure with its label underneath. */
export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-mist bg-white px-4 py-3">
      <p className="font-mono text-lg font-semibold text-ink">{value}</p>
      <p className="text-xs text-charcoal/60">{label}</p>
    </div>
  );
}
