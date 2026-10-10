/**
 * The cities the marketplace actually operates in, with coordinates.
 *
 * ── Why a list rather than a text box ──
 *
 * The caretaker and vet searches take `lat`/`lng`/`radiusMiles` and do the
 * haversine distance in SQL. Nothing in this system geocodes, so a free-text
 * "City or ZIP" field — which is what the reference implementation's search bar
 * had — can only be decorative: it put `location` in the query string and no
 * endpoint ever read it. A control that looks like it filters and does not is
 * worse than one fewer control.
 *
 * A picker of real places is honest, and it is the only way the distance search
 * built in M4 is reachable from the UI at all.
 *
 * Coordinates are the city centres, deliberately not any particular
 * professional's address — the distance shown on a card is "how far from the
 * middle of town", which is what somebody choosing a city means.
 *
 * **Widening this is a data question, not a code one.** Add a city here only
 * when there are professionals in it; an empty result set that looks like a bug
 * is the cost otherwise. The seeded marketplace is Austin, Denver and Portland.
 */
export interface City {
  /** Stable key, used in the query string. */
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export const CITIES: City[] = [
  { id: "austin", label: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { id: "denver", label: "Denver, CO", lat: 39.7392, lng: -104.9903 },
  { id: "portland", label: "Portland, OR", lat: 45.5152, lng: -122.6784 },
];

/** The default radius for a city search, in miles. Generous — a metro area. */
export const CITY_RADIUS_MILES = 30;

export function cityById(id: string | null | undefined): City | undefined {
  return id ? CITIES.find((c) => c.id === id) : undefined;
}
