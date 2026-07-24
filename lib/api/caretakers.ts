/**
 * Caretakers domain — API client. See /lib/api/users.ts for the pattern.
 *
 * Search returns caretakers already joined with their owning User and a
 * computed price range + distance, because that's the shape every list/detail
 * view actually renders. A real backend would do this join server-side.
 */

import type {
  CaretakerProfile,
  CaretakerWithUser,
  SearchParams,
} from "@/types";
import { db, delay } from "./_db";
import { distanceMiles } from "@/lib/utils";

function priceRange(c: CaretakerProfile): { min: number; max: number } {
  const rates = c.pricing.map((p) => p.rate);
  return { min: Math.min(...rates), max: Math.max(...rates) };
}

function join(c: CaretakerProfile, origin?: { lat: number; lng: number }): CaretakerWithUser {
  const user = db.users.find((u) => u.id === c.userId)!;
  return {
    ...c,
    user,
    priceRange: priceRange(c),
    distanceMiles: origin ? distanceMiles(origin, user.address) : undefined,
  };
}

/**
 * GET /api/caretakers/search
 * Query: { lat?: number; lng?: number; radiusMiles?: number; serviceType?: ServiceType;
 *          species?: Species; startDate?: string; endDate?: string;
 *          minPrice?: number; maxPrice?: number }
 * 200 -> CaretakerWithUser[]  (sorted by distance when lat/lng given, else rating)
 * Used on: /search
 */
export async function searchCaretakers(
  params: SearchParams = {}
): Promise<CaretakerWithUser[]> {
  const origin =
    params.lat != null && params.lng != null
      ? { lat: params.lat, lng: params.lng }
      : undefined;

  let results = db.caretakers.map((c) => join(c, origin));

  if (params.serviceType) {
    results = results.filter((c) => c.servicesOffered.includes(params.serviceType!));
  }
  if (params.species) {
    results = results.filter((c) => c.acceptedSpecies.includes(params.species!));
  }
  if (params.minPrice != null) {
    results = results.filter((c) => c.priceRange.max >= params.minPrice!);
  }
  if (params.maxPrice != null) {
    results = results.filter((c) => c.priceRange.min <= params.maxPrice!);
  }
  if (origin && params.radiusMiles != null) {
    results = results.filter(
      (c) => (c.distanceMiles ?? Infinity) <= params.radiusMiles!
    );
  }
  if (params.startDate) {
    // require at least one open availability slot on/after the requested start
    results = results.filter((c) =>
      c.availability.some(
        (d) => d.date >= params.startDate! && d.slots.length > 0
      )
    );
  }

  results.sort((a, b) =>
    origin
      ? (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0)
      : b.rating - a.rating
  );

  return delay(results);
}

/**
 * GET /api/caretakers/:id
 * 200 -> CaretakerWithUser
 * 404 -> null
 * Used on: /caretaker/[id], /booking/new (selected caretaker), /booking/[id]
 */
export async function getCaretakerById(
  id: string
): Promise<CaretakerWithUser | null> {
  const c = db.caretakers.find((c) => c.id === id);
  return delay(c ? join(c) : null);
}

/**
 * GET /api/users/:userId/caretaker-profile
 * 200 -> CaretakerProfile
 * 404 -> null
 * Used on: /dashboard/caretaker-profile (edit), /dashboard (caretaker view)
 */
export async function getCaretakerByUserId(
  userId: string
): Promise<CaretakerProfile | null> {
  return delay(db.caretakers.find((c) => c.userId === userId) ?? null);
}

/**
 * PATCH /api/caretakers/:id   (or POST to create if none exists yet)
 * Body: Partial<CaretakerProfile>
 * 200 -> CaretakerProfile
 * Used on: /dashboard/caretaker-profile
 */
export async function upsertCaretakerProfile(
  userId: string,
  patch: Partial<CaretakerProfile>
): Promise<CaretakerProfile> {
  let profile = db.caretakers.find((c) => c.userId === userId);
  if (!profile) {
    profile = {
      id: `c${db.caretakers.length + 1}`,
      userId,
      bio: "",
      servicesOffered: [],
      pricing: [],
      serviceRadiusMiles: 10,
      acceptedSpecies: [],
      homeEnvironment: { fencedYard: false, hasOtherPets: false, smokeFree: true },
      certifications: [],
      backgroundCheckStatus: "none",
      rating: 0,
      reviewCount: 0,
      responseRatePct: 100,
      availability: [],
      ...patch,
    };
    db.caretakers.push(profile);
  } else {
    Object.assign(profile, patch);
  }
  return delay({ ...profile });
}
