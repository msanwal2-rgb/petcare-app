import type { AvailabilityDay } from "@/types";
import { addDays, addMonths, dayKey, startOfDay, startOfMonth, PLANNING_MONTHS } from "./calendar";

/**
 * The rules behind the availability editor, kept apart from the screen.
 * They mirror the API's (`AvailabilityDayValidator`): real clock times,
 * each set of hours ends after it starts, none overlap, at most twelve a day.
 * The server checks all of it again.
 */

export type Slot = { start: string; end: string };

export const MAX_SLOTS_PER_DAY = 12;

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sorted by start, so a day reads in order whatever order it was typed. */
export function sortSlots(slots: Slot[]): Slot[] {
  return [...slots].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/** Why these hours cannot be published, or null when they can. */
export function hoursProblem(slots: Slot[]): string | null {
  if (slots.length === 0) return "Add at least one set of hours.";
  if (slots.length > MAX_SLOTS_PER_DAY) return `At most ${MAX_SLOTS_PER_DAY} sets of hours in a day.`;
  for (const s of slots) {
    if (!CLOCK.test(s.start) || !CLOCK.test(s.end)) return "Fill in every start and end time.";
    if (s.end <= s.start) return `${s.start}–${s.end} ends before it starts.`;
  }
  const sorted = sortSlots(slots);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return `${sorted[i - 1].start}–${sorted[i - 1].end} and ${sorted[i].start}–${sorted[i].end} overlap.`;
    }
  }
  return null;
}

/** The last day anyone can publish: the end of the planning horizon. */
export function lastPlannableDay(now: Date = new Date()): string {
  return dayKey(addDays(addMonths(startOfMonth(now), PLANNING_MONTHS + 1), -1));
}

/**
 * Every date from today for `weeks` weeks that falls on one of `weekdays`
 * (0 = Sunday), inside the planning horizon.
 */
export function weeklyDates(weekdays: number[], weeks: number, now: Date = new Date()): string[] {
  const last = lastPlannableDay(now);
  const start = startOfDay(now);
  const out: string[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i);
    const key = dayKey(d);
    if (key > last) break;
    if (weekdays.includes(d.getDay())) out.push(key);
  }
  return out;
}

/**
 * What a save sends: every day from today on, in date order. Days already
 * past are dropped — owners cannot book them, and keeping them would let a
 * calendar grow past the API's bound over the years.
 */
export function toPayload(days: Map<string, Slot[]>, now: Date = new Date()): AvailabilityDay[] {
  const today = dayKey(now);
  return [...days.entries()]
    .filter(([date]) => date >= today)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, slots]) => ({ date, slots: sortSlots(slots) }));
}

/** A stable fingerprint of what would be saved — for "unsaved changes". */
export function fingerprint(days: Map<string, Slot[]>, now: Date = new Date()): string {
  return JSON.stringify(toPayload(days, now));
}

export function toMap(availability: AvailabilityDay[]): Map<string, Slot[]> {
  return new Map(availability.map((d) => [d.date, d.slots]));
}

// ── Reading a request against the calendar ────────────────────────────────
//
// The same rules as the API's `PublishedHours` (STATUS §3-G), which is the one
// that decides; these only let the form say so before sending. Hours are the
// browser's local clock, which is what the provider published in.

/** The browser's offset from UTC at that instant, in minutes — what the API wants as `utcOffsetMinutes`. */
export function utcOffsetMinutesAt(iso: string): number {
  // getTimezoneOffset is UTC − local; the API wants local − UTC. `|| 0` keeps
  // UTC itself from being sent as −0.
  return -new Date(iso).getTimezoneOffset() || 0;
}

const DAY_MINUTES = 24 * 60;

function clockMinutes(hhmm: string): number | null {
  if (!CLOCK.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** A day's open hours as minute ranges; a set ending 23:59 runs to midnight. */
function openSets(published: Map<string, Slot[]>, key: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of published.get(key) ?? []) {
    const start = clockMinutes(s.start);
    let end = clockMinutes(s.end);
    if (start === null || end === null) continue;
    if (end === DAY_MINUTES - 1) end = DAY_MINUTES;
    if (end > start) out.push({ start, end });
  }
  return out;
}

function minuteOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * Why a caretaker booking falls outside the published hours, or null when it
 * does not: the drop-off must be in open hours on its day (before closing),
 * the pick-up in open hours on its day (closing time included).
 */
export function stayProblem(
  availability: AvailabilityDay[],
  startIso: string,
  endIso: string,
): string | null {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (!(end > start)) return null; // the dates' own message covers this

  const published = toMap(availability);

  const startMinute = minuteOfDay(start);
  if (!openSets(published, dayKey(start)).some((s) => s.start <= startMinute && startMinute < s.end)) {
    return "The drop-off isn’t during their open hours. Pick a time from their calendar.";
  }

  const endMinute = minuteOfDay(end);
  const pickUpOpen =
    openSets(published, dayKey(end)).some((s) => s.start <= endMinute && endMinute <= s.end) ||
    (endMinute === 0 && openSets(published, dayKey(addDays(end, -1))).some((s) => s.end >= DAY_MINUTES));
  if (!pickUpOpen) {
    return "The pick-up isn’t during their open hours. Pick a time from their calendar.";
  }

  return null;
}

/** A sensible next set of hours after the last one: an hour later, an hour long. */
export function nextSlot(slots: Slot[]): Slot {
  const last = sortSlots(slots).at(-1);
  if (!last) return { start: "09:00", end: "17:00" };
  const [h, m] = last.end.split(":").map(Number);
  const startH = Math.min(h + 1, 22);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { start: `${pad(startH)}:${pad(m)}`, end: `${pad(Math.min(startH + 1, 23))}:${pad(m)}` };
}
