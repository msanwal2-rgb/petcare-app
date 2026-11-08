import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import type { AvailabilityDay } from "@/types";
import { useAsync } from "@/hooks/useAsync";
import { addDays, dayKey, daysCovered, fromDayKey, monthGrid, startOfMonth } from "@/lib/calendar";
import { DayPanel } from "./DayPanel";
import { MonthCalendar } from "./MonthCalendar";
import { UpcomingList } from "./UpcomingList";
import { loadWindow, type Engagement, type EngagementSource } from "./engagement";

/**
 * The dashboards' shared schedule, one shape for the vet, the caretaker and
 * the owner: **Upcoming** — a row of cards, one slim line when there is
 * nothing — and below it the **Calendar** at full width, with the selected
 * day's panel opening under it. What differs is the sources it reads, the
 * actions it attaches and whether there is availability to shade.
 *
 * The list sat beside the calendar at first; empty, it was a tall blank box
 * next to a full month, and the three dashboards looked different depending
 * on how busy each person was. Stacked, the page has the same shape busy or
 * quiet, and the calendar has room to say what is on each day.
 *
 * `version` is the dashboard's refresh counter: bump it after any action and
 * the month, the list and the open day all re-read.
 */
export function ScheduleOverview({
  sources,
  version,
  renderActions,
  availability = [],
  noun,
  emptyUpcoming,
}: {
  sources: EngagementSource[];
  version: number;
  renderActions?: (e: Engagement) => ReactNode;
  availability?: AvailabilityDay[];
  noun: { one: string; many: string };
  emptyUpcoming: string;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  // The selected day; which way the selection last moved (the panel's content
  // slides in from that side); and, when this pick opened the panel, the day
  // box it was opened from (the panel flies out of it).
  const [selection, setSelection] = useState<{
    day: string;
    direction: number;
    origin: DOMRect | null;
  } | null>(null);
  const selectedDay = selection?.day ?? null;

  /** Open a day (or switch to it), or close the panel with null. */
  function selectDay(day: string | null, origin?: DOMRect) {
    setSelection((prev) =>
      day === null
        ? null
        : {
            day,
            direction: prev && day < prev.day ? -1 : 1,
            // Only an opening flies; switching days changes the open panel in place.
            origin: prev ? null : origin ?? null,
          }
    );
  }

  const grid = monthGrid(month);
  const from = grid[0].toISOString();
  const to = addDays(grid[grid.length - 1], 1).toISOString();

  const { data: monthItems, loading } = useAsync(
    () => loadWindow(sources, from, to),
    [from, version],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Engagement[]>();
    for (const e of monthItems ?? []) {
      for (const key of daysCovered(e.start, e.end)) {
        const list = map.get(key) ?? [];
        list.push(e);
        map.set(key, list);
      }
    }
    return map;
  }, [monthItems]);

  const openDays = useMemo(
    () => new Set(availability.filter((a) => a.slots.length > 0).map((a) => a.date)),
    [availability],
  );

  // From a card: jump the calendar to that day and open it. The panel
  // scrolls itself into view once it is there.
  function selectFromList(e: Engagement) {
    const start = new Date(e.start);
    setMonth(startOfMonth(start));
    selectDay(dayKey(start));
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Upcoming</h2>
        <UpcomingList
          sources={sources}
          version={version}
          onSelect={selectFromList}
          noun={noun}
          empty={emptyUpcoming}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Calendar</h2>
        <MonthCalendar
          month={month}
          onMonthChange={(m) => {
            setMonth(m);
            selectDay(null);
          }}
          byDay={byDay}
          openDays={openDays}
          selectedDay={selectedDay}
          onSelectDay={selectDay}
          loading={loading}
          noun={noun}
        />
        {/* One panel while any day is open: it unfolds on the first pick,
            changes in place on the next, and folds away on close. */}
        <AnimatePresence>
          {selection && (
            <DayPanel
              key="day-panel"
              day={selection.day}
              column={fromDayKey(selection.day).getDay()}
              direction={selection.direction}
              origin={selection.origin}
              items={byDay.get(selection.day) ?? []}
              loading={loading}
              availability={availability.find((a) => a.date === selection.day)}
              renderActions={renderActions}
              onClose={() => selectDay(null)}
              noun={noun}
            />
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
