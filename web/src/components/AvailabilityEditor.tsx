import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AvailabilityDay } from "@/types";
import { Button } from "@/components/ui/Button";
import { ChevronRightIcon, PlusIcon, XIcon } from "@/components/ui/icons";
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
import {
  fingerprint,
  hoursProblem,
  lastPlannableDay,
  MAX_SLOTS_PER_DAY,
  nextSlot,
  sortSlots,
  toMap,
  toPayload,
  weeklyDates,
  type Slot,
} from "@/lib/availability";
import { cn } from "@/lib/utils";

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_OPTIONS = [4, 8, 12, 26, 52];
const DEFAULT_HOURS: Slot[] = [
  { start: "09:00", end: "12:00" },
  { start: "13:00", end: "17:00" },
];

/**
 * Where a vet or caretaker publishes the days owners can book — the screen
 * neither this build nor the reference had, which is why every published day
 * was still the seed's July.
 *
 * Pick days on the month (several at once), set the hours, then open or close
 * them; or fill a weekly pattern for weeks ahead. Nothing is sent until
 * "Save availability", which replaces the whole published calendar (the API's
 * rule) with every day from today on.
 */
export function AvailabilityEditor({
  initial,
  onSave,
  audience,
}: {
  initial: AvailabilityDay[];
  /** Persist the calendar; resolves with what the server now holds. */
  onSave: (days: AvailabilityDay[]) => Promise<AvailabilityDay[]>;
  /** Who books — "owners" reads naturally for both roles today. */
  audience?: string;
}) {
  const [days, setDays] = useState(() => toMap(initial));
  const [saved, setSaved] = useState(() => fingerprint(toMap(initial)));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [hours, setHours] = useState<Slot[]>(DEFAULT_HOURS);
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [weeks, setWeeks] = useState(8);
  const [saving, setSaving] = useState(false);

  const today = dayKey(new Date());
  const last = lastPlannableDay();
  const thisMonth = startOfMonth(new Date());
  const lastMonth = addMonths(thisMonth, PLANNING_MONTHS);

  const problem = hoursProblem(hours);
  const dirty = fingerprint(days) !== saved;
  const upcoming = useMemo(
    () => toPayload(days).filter((d) => d.slots.length > 0),
    [days]
  );

  // The dashboard links here as #availability. The section only exists once
  // the profile has loaded — after the browser tried the jump — so do it now.
  useEffect(() => {
    if (window.location.hash === "#availability") {
      document.getElementById("availability")?.scrollIntoView({ block: "start" });
    }
  }, []);

  // Leaving with unsaved hours asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toggleDay(key: string) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Picking a single open day loads its hours, so it can be edited.
    if (next.size === 1 && !selected.has(key)) {
      const existing = days.get(key);
      if (existing && existing.length > 0) setHours(existing.map((s) => ({ ...s })));
    }
    setSelected(next);
  }

  function selectWeekdaysInMonth() {
    const keys = monthGrid(month)
      .filter((d) => d.getMonth() === month.getMonth())
      .filter((d) => d.getDay() !== 0 && d.getDay() !== 6)
      .map(dayKey)
      .filter((k) => k >= today && k <= last);
    setSelected(new Set(keys));
  }

  function openSelected() {
    if (problem || selected.size === 0) return;
    const next = new Map(days);
    const slots = sortSlots(hours);
    for (const key of selected) next.set(key, slots.map((s) => ({ ...s })));
    setDays(next);
    setSelected(new Set());
  }

  function closeSelected() {
    const next = new Map(days);
    for (const key of selected) next.delete(key);
    setDays(next);
    setSelected(new Set());
  }

  function fillWeekly() {
    if (problem || weekdays.length === 0) return;
    const dates = weeklyDates(weekdays, weeks);
    const next = new Map(days);
    const slots = sortSlots(hours);
    for (const key of dates) next.set(key, slots.map((s) => ({ ...s })));
    setDays(next);
    toast.success(`${dates.length} days filled`, { description: "Save to publish them." });
  }

  async function save() {
    setSaving(true);
    try {
      const result = await onSave(toPayload(days));
      const map = toMap(result);
      setDays(map);
      setSaved(fingerprint(map));
      setSelected(new Set());
      toast.success("Availability saved", {
        description: `${audience ?? "Owners"} can book the days you opened.`,
      });
    } catch (e) {
      toast.error("Couldn't save your availability", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const parsed = JSON.parse(saved) as AvailabilityDay[];
    setDays(toMap(parsed));
    setSelected(new Set());
  }

  const single = selected.size === 1 ? [...selected][0] : null;
  const singleHours = single ? days.get(single) : undefined;

  return (
    <div className="space-y-5">
      {/* The month */}
      <div className="rounded-xl border border-mist p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink" aria-live="polite">
            {formatMonth(month)}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={selectWeekdaysInMonth}
              className="rounded-full px-3 py-1 text-xs font-medium text-charcoal/70 hover:bg-fog hover:text-ink"
            >
              Select weekdays
            </button>
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

        <div className="mb-1.5 grid grid-cols-7 gap-1.5">
          {WEEKDAY_LETTERS.map((w, i) => (
            <div key={i} className="text-center font-mono text-[10px] uppercase text-charcoal/40">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {monthGrid(month).map((d) => {
            const key = dayKey(d);
            if (d.getMonth() !== month.getMonth()) return <div key={key} aria-hidden />;
            const editable = key >= today && key <= last;
            const slots = days.get(key);
            const open = !!slots && slots.length > 0;
            const isSelected = selected.has(key);
            return (
              <button
                key={key}
                type="button"
                disabled={!editable}
                onClick={() => toggleDay(key)}
                aria-pressed={isSelected}
                aria-label={`${formatLongDay(d)}, ${
                  !editable ? "past" : open ? `open ${slots!.map((s) => `${s.start} to ${s.end}`).join(", ")}` : "closed"
                }`}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center rounded-lg border font-mono text-xs transition-colors",
                  !editable
                    ? "cursor-default border-transparent text-charcoal/25"
                    : open
                      ? "border-[#2F6F5E]/25 bg-[#2F6F5E]/10 text-ink hover:bg-[#2F6F5E]/18"
                      : "border-mist bg-white text-ink hover:border-ink/40",
                  isSelected && "ring-2 ring-leash ring-offset-1",
                  key === today && "font-semibold"
                )}
              >
                <span>{d.getDate()}</span>
                {open && (
                  <span className="mt-0.5 hidden text-[9px] leading-none text-[#215144] sm:block">
                    {slots![0].start}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-charcoal/60">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#2F6F5E]/40" /> Open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-mist bg-white" /> Closed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm ring-2 ring-leash" /> Selected
          </span>
        </div>
      </div>

      {/* The hours */}
      <div className="rounded-xl border border-mist p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Hours</p>
          <p className="text-xs text-charcoal/60">
            {selected.size === 0
              ? "Pick days on the calendar"
              : single
                ? `${formatLongDay(fromDayKey(single))} · ${
                    singleHours && singleHours.length > 0
                      ? `now ${singleHours.map((s) => `${s.start}–${s.end}`).join(", ")}`
                      : "now closed"
                  }`
                : `${selected.size} days selected`}
          </p>
        </div>

        <ul className="mt-3 space-y-2">
          {hours.map((slot, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="time"
                aria-label={`Hours ${i + 1} start`}
                value={slot.start}
                onChange={(e) =>
                  setHours(hours.map((s, j) => (j === i ? { ...s, start: e.target.value } : s)))
                }
                className="rounded-xl border border-mist bg-white px-3 py-2 font-mono text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
              />
              <span className="text-charcoal/50">–</span>
              <input
                type="time"
                aria-label={`Hours ${i + 1} end`}
                value={slot.end}
                onChange={(e) =>
                  setHours(hours.map((s, j) => (j === i ? { ...s, end: e.target.value } : s)))
                }
                className="rounded-xl border border-mist bg-white px-3 py-2 font-mono text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
              />
              <button
                type="button"
                aria-label={`Remove hours ${i + 1}`}
                disabled={hours.length === 1}
                onClick={() => setHours(hours.filter((_, j) => j !== i))}
                className="flex h-8 w-8 items-center justify-center rounded-full text-charcoal/50 hover:bg-fog hover:text-ink disabled:opacity-30"
              >
                <XIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          disabled={hours.length >= MAX_SLOTS_PER_DAY}
          onClick={() => setHours([...hours, nextSlot(hours)])}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-leash hover:text-leash-hover disabled:opacity-40"
        >
          <PlusIcon width={14} height={14} /> Add hours
        </button>

        {problem && (
          <p className="mt-2 text-xs text-leash" role="alert">
            {problem}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={selected.size === 0 || !!problem}
            onClick={openSelected}
          >
            Open {selected.size > 1 ? `${selected.size} days` : "day"} with these hours
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={selected.size === 0}
            onClick={closeSelected}
          >
            Close {selected.size > 1 ? `${selected.size} days` : "day"}
          </Button>
          {selected.size > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          )}
        </div>
      </div>

      {/* A weekly pattern */}
      <div className="rounded-xl border border-mist p-4">
        <p className="text-sm font-semibold text-ink">Repeat every week</p>
        <p className="mt-0.5 text-xs text-charcoal/60">
          Opens the days you pick, with the hours above, from today on.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Days of the week">
            {WEEKDAY_NAMES.map((name, i) => {
              const on = weekdays.includes(i);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  aria-label={name}
                  onClick={() =>
                    setWeekdays(on ? weekdays.filter((w) => w !== i) : [...weekdays, i])
                  }
                  className={cn(
                    "h-8 w-9 rounded-lg border font-mono text-xs transition-colors",
                    on ? "border-ink bg-ink text-white" : "border-mist bg-white text-charcoal hover:border-ink/40"
                  )}
                >
                  {WEEKDAY_LETTERS[i]}
                </button>
              );
            })}
          </div>
          <select
            aria-label="For how many weeks"
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
            className="rounded-xl border border-mist bg-white px-3 py-1.5 text-sm text-charcoal focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
          >
            {WEEK_OPTIONS.map((w) => (
              <option key={w} value={w}>
                for {w} weeks
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={weekdays.length === 0 || !!problem}
            onClick={fillWeekly}
          >
            Fill
          </Button>
        </div>
      </div>

      {/* Save */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mist pt-4">
        <p className="text-xs text-charcoal/60">
          {upcoming.length === 0
            ? "No days open from today — owners can't book you yet."
            : `${upcoming.length} open day${upcoming.length === 1 ? "" : "s"} from today · next ${formatLongDay(
                fromDayKey(upcoming[0].date)
              )}`}
          {dirty && <span className="ml-2 font-medium text-[#946412]">· Unsaved changes</span>}
        </p>
        <div className="flex gap-2">
          {dirty && (
            <Button type="button" size="sm" variant="ghost" onClick={discard} disabled={saving}>
              Discard
            </Button>
          )}
          <Button type="button" size="sm" variant="cta" onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save availability"}
          </Button>
        </div>
      </div>
    </div>
  );
}
