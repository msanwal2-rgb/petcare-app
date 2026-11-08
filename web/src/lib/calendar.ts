/**
 * Calendar arithmetic for the dashboards, in the viewer's own time zone.
 *
 * Stored times are UTC instants; a calendar day is local. Everything here
 * turns one into the other in exactly one way, so the month grid, the day
 * panel, the "upcoming" list and the `from` sent to the server agree on where
 * a day starts.
 */

const DAY_MS = 86_400_000;

/**
 * How far ahead a provider can publish hours, and an owner can page. A year
 * keeps a published calendar inside the API's 400-day bound.
 */
export const PLANNING_MONTHS = 12;

/** Local midnight at the start of `d`'s day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The first of `d`'s month, at local midnight. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** "2026-11-08" for the local day `d` falls on. The key every map here uses. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** The local day a key names, at midnight. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The ISO instant the viewer's today began — what the stats and "upcoming" reads send as `from`. */
export function startOfTodayIso(now: Date = new Date()): string {
  return startOfDay(now).toISOString();
}

/**
 * The 42 days a month grid shows: six full weeks from the Sunday on or before
 * the first. Always six rows, so the page does not jump between months.
 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/**
 * Every local day an engagement touches. The end is exclusive, so a stay
 * ending at midnight does not mark the morning after; something with no
 * length still marks the day it is on. Capped so a malformed row cannot spin.
 */
export function daysCovered(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const keys: string[] = [];
  for (let d = startOfDay(start); d < end || keys.length === 0; d = addDays(d, 1)) {
    keys.push(dayKey(d));
    if (keys.length > 62) break;
  }
  return keys;
}

export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/** Whole days from today to `d`, by local calendar day (0 = today). */
export function daysFromToday(d: Date, now: Date = new Date()): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / DAY_MS);
}

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const LONG_DAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const WEEKDAY_SHORT_FMT = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const TIME_FMT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

export const formatMonth = (d: Date) => MONTH_FMT.format(d);
export const formatLongDay = (d: Date) => LONG_DAY_FMT.format(d);
export const formatWeekdayShort = (d: Date) => WEEKDAY_SHORT_FMT.format(d);
export const formatTime = (iso: string) => TIME_FMT.format(new Date(iso));

/** "Today", "Tomorrow", or "Wednesday, November 11". */
export function relativeDayLabel(d: Date, now: Date = new Date()): string {
  const n = daysFromToday(d, now);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return formatLongDay(d);
}

/** The value a `<input type="date">` wants for a local instant. */
export function toDateInput(iso: string): string {
  return dayKey(new Date(iso));
}

/** The value a `<input type="time">` wants for a local instant. */
export function toTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A local date and time from two inputs, as an ISO instant. Null if either is blank. */
export function fromDateTimeInputs(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const local = new Date(y, m - 1, d, hh, mm);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}
