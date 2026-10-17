/**
 * The late-cancellation warning (REQUIREMENTS.md C14, decided 2026-10-10).
 *
 * Cancelling stays free and always allowed — §11.1 and §11.2 as written, no
 * cutoff and no penalty. What changes is only this: inside the last twelve
 * hours, the person cancelling is told what it costs the other side and asked
 * to confirm. A UI warning, not a rule — the server does not know about it,
 * and nothing here can refuse a cancellation. Bookings and vet appointments
 * both (owner's decision, 2026-10-17).
 */

export const LATE_CANCEL_HOURS = 12;

const HOUR_MS = 3_600_000;

/** True when the engagement starts within the window — or has already started. */
export function startsWithinLateWindow(startIso: string, now: number = Date.now()): boolean {
  const start = Date.parse(startIso);
  return !Number.isNaN(start) && start - now < LATE_CANCEL_HOURS * HOUR_MS;
}

/**
 * Ask before a late cancellation; say nothing for an early one. Returns
 * whether to go ahead.
 */
export function confirmCancellation(startIso: string, otherParty: string): boolean {
  if (!startsWithinLateWindow(startIso)) return true;
  return window.confirm(
    `This starts in less than ${LATE_CANCEL_HOURS} hours.\n\n` +
      `${otherParty} may already have set the time aside, and it is hard to fill at short notice. ` +
      "Cancelling is still free.\n\nCancel anyway?"
  );
}
