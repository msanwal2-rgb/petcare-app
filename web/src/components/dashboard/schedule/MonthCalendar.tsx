import { TONE_DOT } from "@/lib/statusTone";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  addMonths,
  dayKey,
  formatLongDay,
  formatMonth,
  monthGrid,
  startOfMonth,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { Engagement } from "./engagement";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A month grid. Each day carries a dot per engagement on it (coloured by
 * status, up to three, then a count), a shaded background when the provider
 * has published availability for it, and a ring for today. Pressing a day
 * selects it; pressing it again closes the panel below.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  byDay,
  openDays,
  selectedDay,
  onSelectDay,
  loading,
  noun,
}: {
  month: Date;
  onMonthChange: (month: Date) => void;
  byDay: Map<string, Engagement[]>;
  /** Day keys with published availability. Empty for owners. */
  openDays: Set<string>;
  selectedDay: string | null;
  onSelectDay: (key: string | null) => void;
  loading: boolean;
  noun: { one: string; many: string };
}) {
  const today = dayKey(new Date());
  const thisMonth = month.getMonth();
  const days = monthGrid(month);

  return (
    <div className="rounded-2xl border border-mist bg-white p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink" aria-live="polite">
          {formatMonth(month)}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMonthChange(startOfMonth(new Date()))}
            className="rounded-full px-3 py-1 text-xs font-medium text-charcoal/70 hover:bg-fog hover:text-ink"
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(addMonths(month, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-fog"
          >
            <ChevronRightIcon width={16} height={16} className="rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(addMonths(month, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-fog"
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-busy={loading}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="pb-1 font-mono text-[10px] uppercase tracking-wider text-charcoal/50"
          >
            {d}
          </div>
        ))}

        {days.map((d) => {
          const key = dayKey(d);
          const items = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === thisMonth;
          const selected = key === selectedDay;
          const open = openDays.has(key);
          const count = items.length;

          return (
            <button
              key={key}
              type="button"
              role="gridcell"
              aria-selected={selected}
              aria-label={`${formatLongDay(d)}${
                count ? `, ${count} ${count === 1 ? noun.one : noun.many}` : ""
              }${open ? ", open for bookings" : ""}`}
              onClick={() => onSelectDay(selected ? null : key)}
              className={cn(
                "relative flex aspect-square min-h-11 flex-col items-center justify-start rounded-xl pt-1.5 text-sm transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                inMonth ? "text-ink" : "text-charcoal/30",
                open && !selected && "bg-[#2F6F5E]/[0.07]",
                selected ? "bg-ink text-white" : "hover:bg-fog",
                key === today && !selected && "ring-1 ring-inset ring-leash",
              )}
            >
              <span className={cn("font-mono text-xs sm:text-sm", key === today && "font-semibold")}>
                {d.getDate()}
              </span>
              {count > 0 && (
                <span className="mt-auto mb-1.5 flex items-center gap-0.5" aria-hidden>
                  {items.slice(0, 3).map((e) => (
                    <span
                      key={e.kind + e.id}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: selected ? "#fff" : TONE_DOT[e.tone] }}
                    />
                  ))}
                  {count > 3 && (
                    <span className={cn("font-mono text-[9px] leading-none", selected ? "text-white" : "text-charcoal/60")}>
                      +{count - 3}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-charcoal/55">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT.pending }} />
          Awaiting reply
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT.active }} />
          Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT.done }} />
          Done
        </span>
        {openDays.size > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded bg-[#2F6F5E]/15" />
            Open for bookings
          </span>
        )}
        {loading && <span className="ml-auto">Loading…</span>}
      </div>
    </div>
  );
}
