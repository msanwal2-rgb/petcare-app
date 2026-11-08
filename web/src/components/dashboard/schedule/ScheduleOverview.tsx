import { useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import type { AvailabilityDay } from "@/types";
import { useAsync } from "@/hooks/useAsync";
import { addDays, dayKey, daysCovered, monthGrid, startOfMonth } from "@/lib/calendar";
import { DayPanel } from "./DayPanel";
import { MonthCalendar } from "./MonthCalendar";
import { UpcomingList } from "./UpcomingList";
import { loadWindow, type Engagement, type EngagementSource } from "./engagement";

/**
 * The dashboards' shared schedule: the "upcoming" list beside an interactive
 * month calendar, and the selected day's panel under the calendar. One
 * component for the vet, the caretaker and the owner — what differs is the
 * sources it reads, the actions it attaches and whether there is availability
 * to shade.
 *
 * Side by side from `lg`, the list first; stacked on a phone with the list
 * above the calendar.
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
  const calendarRef = useRef<HTMLDivElement>(null);

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

  function selectFromList(e: Engagement) {
    const start = new Date(e.start);
    setMonth(startOfMonth(start));
    setSelectedDay(dayKey(start));
    calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <UpcomingList
        sources={sources}
        version={version}
        onSelect={selectFromList}
        noun={noun}
        empty={emptyUpcoming}
      />

      <div ref={calendarRef} className="scroll-mt-24">
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
      </div>
    </div>
  );
}
