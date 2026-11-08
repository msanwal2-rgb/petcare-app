import { useState } from "react";
import type { AvailabilityDay } from "@/types";
import { ChevronRightIcon } from "@/components/ui/icons";
import {
  addMonths,
  dayKey,
  formatLongDay,
  formatMonth,
  fromDayKey,
  monthGrid,
  startOfMonth,
  PLANNING_MONTHS,
} from "@/lib/calendar";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

type Slot = { start: string; end: string };

/**
 * A month calendar of somebody's published availability, with previous /
 * next. Only published days with hours can be picked; past days cannot.
 *
 * It used to lay out only the published days themselves, with no months to
 * move between — so once those days were in the past (every seeded day is
 * July 2026) it showed a stale July. It now starts at this month, and the
 * provider publishes days with the editor on their profile page.
 *
 * Slot times are wall-clock "HH:MM" on the selected day.
 */
export function AvailabilityCalendar({
  availability,
  selectedDate,
  onSelectDate,
  onSelectSlot,
  selectedSlot,
  emptyLabel = "This caretaker hasn’t published their availability yet.",
  className,
}: {
  availability: AvailabilityDay[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
  /** When provided, the time slots become selectable rather than decorative. */
  onSelectSlot?: (slot: Slot) => void;
  selectedSlot?: Slot;
  emptyLabel?: string;
  className?: string;
}) {
  const today = dayKey(new Date());
  const published = new Map(availability.map((d) => [d.date, d]));
  const upcoming = availability.filter((d) => d.date >= today && d.slots.length > 0);

  const thisMonth = startOfMonth(new Date());
  const lastMonth = addMonths(thisMonth, PLANNING_MONTHS);
  const [month, setMonth] = useState(() => {
    // The selected day's month, else the first month with something open.
    const anchor = selectedDate ?? upcoming[0]?.date;
    const start = anchor ? startOfMonth(fromDayKey(anchor)) : thisMonth;
    return start < thisMonth ? thisMonth : start > lastMonth ? lastMonth : start;
  });

  if (upcoming.length === 0) {
    return (
      <p className="rounded-[12px] border border-dashed border-mist bg-white/60 px-4 py-6 text-center text-sm text-charcoal/60">
        {emptyLabel}
      </p>
    );
  }

  const selected = selectedDate ? published.get(selectedDate) : undefined;

  return (
    <div className={cn("rounded-[12px] border border-mist bg-white p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink" aria-live="polite">
          {formatMonth(month)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={month <= thisMonth}
            onClick={() => setMonth(addMonths(month, -1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-fog disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRightIcon width={16} height={16} className="rotate-180" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={month >= lastMonth}
            onClick={() => setMonth(addMonths(month, 1))}
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink hover:bg-fog disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-center font-mono text-[10px] uppercase tracking-wide text-charcoal/40"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {monthGrid(month).map((d) => {
          const key = dayKey(d);
          if (d.getMonth() !== month.getMonth()) return <div key={key} aria-hidden />;

          const day = published.get(key);
          const past = key < today;
          const open = !past && !!day && day.slots.length > 0;
          const booked = !past && !!day && day.slots.length === 0;
          const interactive = open && !!onSelectDate;
          const isSelected = key === selectedDate;

          return (
            <button
              key={key}
              type="button"
              disabled={!interactive}
              onClick={() => interactive && onSelectDate!(key)}
              aria-pressed={isSelected}
              aria-label={`${formatLongDay(d)}, ${
                past ? "past" : open ? "available" : booked ? "fully booked" : "not open"
              }`}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-lg border text-xs font-mono transition-colors",
                isSelected
                  ? "border-leash bg-leash text-white"
                  : open
                    ? "border-[#2F6F5E]/25 bg-[#2F6F5E]/8 text-ink hover:bg-[#2F6F5E]/16"
                    : booked
                      ? "border-mist bg-fog text-charcoal/35"
                      : "border-transparent text-charcoal/30",
                interactive ? "cursor-pointer" : "cursor-default",
                key === today && !isSelected && "ring-1 ring-inset ring-leash/60"
              )}
            >
              <span>{d.getDate()}</span>
              <span
                className={cn(
                  "mt-0.5 h-1 w-1 rounded-full",
                  isSelected ? "bg-white" : open ? "bg-[#2F6F5E]" : "bg-transparent"
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center gap-4 border-t border-mist pt-3 text-[11px] text-charcoal/60">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#2F6F5E]/40" /> Open
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-mist" /> Booked
        </span>
      </div>

      {selected && selected.slots.length > 0 && selected.date >= today && (
        <div className="mt-3 border-t border-mist pt-3">
          <p className="mb-2 text-xs font-medium text-ink">
            Times on {formatLongDay(fromDayKey(selected.date))}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selected.slots.map((s, i) => {
              const chosen =
                selectedSlot?.start === s.start && selectedSlot?.end === s.end;
              const label = `${s.start}–${s.end}`;
              return onSelectSlot ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSelectSlot(s)}
                  aria-pressed={chosen}
                  className={cn(
                    "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                    chosen
                      ? "border-leash bg-leash text-white"
                      : "border-mist bg-fog text-charcoal hover:border-ink"
                  )}
                >
                  {label}
                </button>
              ) : (
                <span
                  key={i}
                  className="rounded-full border border-mist bg-fog px-2.5 py-1 font-mono text-[11px] text-charcoal"
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
