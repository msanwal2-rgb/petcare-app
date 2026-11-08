import { ChevronRightIcon } from "@/components/ui/icons";
import {
  addMonths,
  dayKey,
  formatLongDay,
  formatMonth,
  formatTimeCompact,
  monthGrid,
  startOfMonth,
} from "@/lib/calendar";
import { TONE_DOT } from "@/lib/statusTone";
import { cn } from "@/lib/utils";
import type { Engagement } from "./engagement";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Labels a day shows before it says "+N more". */
const LABELS_PER_DAY = 2;

/**
 * A month grid, full width. Every day says what is on it — on a phone as a
 * dot per engagement (coloured by status), from `sm` up as short labels
 * ("9:00a Biscuit") and "+N more". Days the provider has published are
 * shaded; today has a ring. Pressing a day selects it; pressing it again
 * closes the panel below.
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
  // Only the weeks this month spans — four to six — not always six. At full
  // width a spare week of next month is a lot of empty page.
  const grid = monthGrid(month);
  const lastOfMonth = grid.findLastIndex((d) => d.getMonth() === thisMonth);
  const days = grid.slice(0, Math.ceil((lastOfMonth + 1) / 7) * 7);
  const monthCount = days
    .filter((d) => d.getMonth() === thisMonth)
    .reduce((n, d) => n + (byDay.get(dayKey(d))?.length ?? 0), 0);

  return (
    <div className="rounded-2xl border border-mist bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-ink" aria-live="polite">
            {formatMonth(month)}
          </h3>
          <p className="text-xs text-charcoal/55">
            {loading
              ? "Loading…"
              : monthCount === 0
                ? `No ${noun.many} this month`
                : `${monthCount} ${monthCount === 1 ? noun.one : noun.many} this month`}
          </p>
        </div>
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

      <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="grid" aria-busy={loading}>
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="pb-1 text-center font-mono text-[10px] uppercase tracking-wider text-charcoal/50"
          >
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}

        {days.map((d) => {
          const key = dayKey(d);
          const items = byDay.get(key) ?? [];
          const inMonth = d.getMonth() === thisMonth;
          const selected = key === selectedDay;
          const open = openDays.has(key);
          const isToday = key === today;
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
                "relative flex min-w-0 flex-col rounded-xl border p-1 text-left transition-colors",
                "aspect-square min-h-11 items-center sm:aspect-auto sm:h-20 sm:items-stretch lg:h-24",
                "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink",
                selected
                  ? "border-ink bg-ink text-white"
                  : open
                    ? "border-[#2F6F5E]/15 bg-[#2F6F5E]/[0.06] hover:border-ink/30"
                    : "border-transparent hover:border-mist hover:bg-fog/60",
                !inMonth && !selected && "opacity-40",
                isToday && !selected && "ring-1 ring-inset ring-leash"
              )}
            >
              <span
                className={cn(
                  "font-mono text-xs sm:px-1 sm:text-[13px]",
                  isToday && "font-semibold",
                  !selected && (inMonth ? "text-ink" : "text-charcoal/60")
                )}
              >
                {d.getDate()}
              </span>

              {/* Phones: a dot per engagement. */}
              {count > 0 && (
                <span className="mt-auto mb-1 flex items-center gap-0.5 sm:hidden" aria-hidden>
                  {items.slice(0, 3).map((e) => (
                    <span
                      key={e.kind + e.id}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: selected ? "#fff" : TONE_DOT[e.tone] }}
                    />
                  ))}
                </span>
              )}

              {/* Wider: what it is. */}
              {count > 0 && (
                <span className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
                  {items.slice(0, LABELS_PER_DAY).map((e) => (
                    <span
                      key={e.kind + e.id}
                      className={cn(
                        "truncate rounded-md border-l-2 px-1 py-0.5 text-[10px] leading-tight",
                        selected ? "bg-white/15 text-white" : "bg-fog text-charcoal"
                      )}
                      style={{ borderLeftColor: TONE_DOT[e.tone] }}
                    >
                      <span className="font-mono">
                        {dayKey(new Date(e.start)) === key ? formatTimeCompact(e.start) : "…"}
                      </span>{" "}
                      {e.pets[0]?.name ?? e.title}
                    </span>
                  ))}
                  {count > LABELS_PER_DAY && (
                    <span
                      className={cn(
                        "px-1 text-[10px] font-medium",
                        selected ? "text-white/80" : "text-charcoal/60"
                      )}
                    >
                      +{count - LABELS_PER_DAY} more
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
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TONE_DOT.progress }} />
          Under way
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
      </div>
    </div>
  );
}
