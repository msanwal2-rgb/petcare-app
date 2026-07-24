/**
 * Caretakers domain — API client. See /lib/api/users.ts for the pattern.
 * The server computes the User join, priceRange, distance, filtering and sort.
 */

import type {
  CaretakerProfile,
  CaretakerWithUser,
  SearchParams,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/** GET /api/caretakers/search -> CaretakerWithUser[] */
export async function searchCaretakers(
  params: SearchParams = {}
): Promise<CaretakerWithUser[]> {
  return getJson<CaretakerWithUser[]>(
    `/api/caretakers/search${qs({
      lat: params.lat,
      lng: params.lng,
      radiusMiles: params.radiusMiles,
      serviceType: params.serviceType,
      species: params.species,
      startDate: params.startDate,
      endDate: params.endDate,
      minPrice: params.minPrice,
      maxPrice: params.maxPrice,
    })}`
  );
}

/** GET /api/caretakers/:id -> CaretakerWithUser | null(404) */
export async function getCaretakerById(
  id: string
): Promise<CaretakerWithUser | null> {
  return getJsonOrNull<CaretakerWithUser>(`/api/caretakers/${id}`);
}

/** GET /api/users/:userId/caretaker-profile -> CaretakerProfile | null */
export async function getCaretakerByUserId(
  userId: string
): Promise<CaretakerProfile | null> {
  return getJson<CaretakerProfile | null>(
    `/api/users/${userId}/caretaker-profile`
  );
}

/** PATCH /api/users/:userId/caretaker-profile -> CaretakerProfile (upsert) */
export async function upsertCaretakerProfile(
  userId: string,
  patch: Partial<CaretakerProfile>
): Promise<CaretakerProfile> {
  return patchJson<CaretakerProfile>(
    `/api/users/${userId}/caretaker-profile`,
    patch
  );
}
