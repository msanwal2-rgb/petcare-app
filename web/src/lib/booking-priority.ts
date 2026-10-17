/**
 * Priority booking, the third Leash Plus benefit.
 *
 * Enforced rather than decorative, which took choosing a mechanic with teeth.
 * A badge on a card is not a benefit; neither is a sort order nobody can see.
 * Lead time is: same-day and next-morning slots are members-only, because a
 * non-member has to ask at least a day ahead.
 *
 * Dependency-free so the booking forms can explain the rule with the same
 * numbers the server enforces it with.
 */

export const LEAD_TIME_HOURS = { member: 2, standard: 24 } as const;

const HOUR_MS = 3_600_000;

/** The earliest start time this customer may request. */
export function earliestBookableAt(now: Date, member: boolean): string {
  const hours = member ? LEAD_TIME_HOURS.member : LEAD_TIME_HOURS.standard;
  return new Date(now.getTime() + hours * HOUR_MS).toISOString();
}

export function meetsLeadTime(
  startDateTime: string,
  now: Date,
  member: boolean
): boolean {
  const start = Date.parse(startDateTime);
  if (Number.isNaN(start)) return false;
  return start >= Date.parse(earliestBookableAt(now, member));
}
