import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";

export interface StatCard {
  label: string;
  value: string;
  /** One line on what is counted, so a figure never overclaims. */
  hint: string;
  icon: ReactNode;
}

/**
 * The dashboards' top row: three figures the server counted. Skeletons while
 * they load, a dash if they could not be read — never a zero that is not one.
 */
export function StatCards({
  cards,
  loading,
  failed,
}: {
  cards: StatCard[];
  loading: boolean;
  failed: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="flex items-start gap-3 rounded-2xl border border-mist bg-white p-4"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fog text-ink">
            {card.icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-charcoal/65">{card.label}</p>
            {loading ? (
              <Skeleton className="mt-1 h-7 w-20" />
            ) : (
              <p className="font-mono text-2xl font-semibold tracking-tight text-ink">
                {failed ? "—" : card.value}
              </p>
            )}
            <p className="mt-0.5 text-[11px] leading-snug text-charcoal/50">{card.hint}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
