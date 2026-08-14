/**
 * Location helpers shared by the caretaker and vet searches.
 *
 * Approximate coordinates for the demo cities so radius filtering and distance
 * sorting work without a geocoder. A production build would call a geocoding
 * API here and keep the rest of the search code unchanged.
 */

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  austin: { lat: 30.2672, lng: -97.7431 },
  denver: { lat: 39.7392, lng: -104.9903 },
  portland: { lat: 45.5152, lng: -122.6784 },
};

/** Best-effort coordinates for a free-text location like "Austin, TX". */
export function coordsFor(
  location?: string
): { lat: number; lng: number } | undefined {
  if (!location) return undefined;
  const key = location.toLowerCase();
  const match = Object.keys(CITY_COORDS).find((c) => key.includes(c));
  return match ? CITY_COORDS[match] : undefined;
}
