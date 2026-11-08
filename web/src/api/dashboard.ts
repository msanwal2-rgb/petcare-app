import { getJson, qs } from "./_client";

/**
 * The dashboards' top cards — counted on the server over every row, not over
 * the page a dashboard happens to hold.
 *
 * `from` is the start of the viewer's today. The browser knows its time zone
 * and the server does not, so the client says when today began.
 */

/** A vet's or caretaker's cards. */
export interface ProviderStats {
  /** Requested, confirmed/accepted, in progress or completed — not declined or cancelled. */
  total: number;
  /** Still live and not over before today. */
  upcoming: number;
  completed: number;
  /**
   * The quoted price of completed work, in cents. Bookings and vet visits are
   * not charged through Leash, so this is the value of finished work — not
   * money received.
   */
  earnedCents: number;
}

/** An owner's cards — bookings and vet visits together. */
export interface OwnerStats {
  requests: number;
  upcoming: number;
  completed: number;
  /** What the ledger actually took — store, Leash Plus, adoption fees — less refunds. */
  spentCents: number;
}

/** GET /vets/:id/stats — the clinic's own; 404 to anyone else. */
export function getVetStats(vetId: string, from: string): Promise<ProviderStats> {
  return getJson<ProviderStats>(`/vets/${vetId}/stats${qs({ from })}`);
}

/** GET /caretakers/:id/stats — the caretaker's own; 404 to anyone else. */
export function getCaretakerStats(caretakerId: string, from: string): Promise<ProviderStats> {
  return getJson<ProviderStats>(`/caretakers/${caretakerId}/stats${qs({ from })}`);
}

/** GET /me/stats — the caller's own, as an owner. */
export function getMyStats(from: string): Promise<OwnerStats> {
  return getJson<OwnerStats>(`/me/stats${qs({ from })}`);
}
