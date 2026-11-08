import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import type { AvailabilityDay } from "@/types";
import { useAsync } from "@/hooks/useAsync";
import { addDays, dayKey, daysCovered, monthGrid, startOfMonth } from "@/lib/calendar";
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
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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
    setSelectedDay(dayKey(start));
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
            setSelectedDay(null);
          }}
          byDay={byDay}
          openDays={openDays}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
          loading={loading}
          noun={noun}
        />
        <AnimatePresence mode="wait">
          {selectedDay && (
            <DayPanel
              key={selectedDay}
              day={selectedDay}
              items={byDay.get(selectedDay) ?? []}
              loading={loading}
              availability={availability.find((a) => a.date === selectedDay)}
              renderActions={renderActions}
              onClose={() => setSelectedDay(null)}
              noun={noun}
            />
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
