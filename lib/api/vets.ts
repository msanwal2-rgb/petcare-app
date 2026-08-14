/**
 * Vets domain — API client. See /lib/api/caretakers.ts for the pattern:
 * thin fetch wrappers, all filtering and the User join done server-side.
 */

import type { VetProfile, VetSearchParams, VetWithUser } from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/** GET /api/vets/search -> VetWithUser[] */
export async function searchVets(
  params: VetSearchParams = {}
): Promise<VetWithUser[]> {
  return getJson<VetWithUser[]>(
    `/api/vets/search${qs({
      lat: params.lat,
      lng: params.lng,
      radiusMiles: params.radiusMiles,
      specialty: params.specialty,
      species: params.species,
      mode: params.mode,
      emergencyOnly: params.emergencyOnly || undefined,
    })}`
  );
}

/** GET /api/vets/:id -> VetWithUser | null(404) */
export async function getVetById(id: string): Promise<VetWithUser | null> {
  return getJsonOrNull<VetWithUser>(`/api/vets/${id}`);
}

/** GET /api/users/:userId/vet-profile -> VetProfile | null */
export async function getVetByUserId(userId: string): Promise<VetProfile | null> {
  return getJson<VetProfile | null>(`/api/users/${userId}/vet-profile`);
}

/** PATCH /api/users/:userId/vet-profile -> VetProfile (upsert) */
export async function upsertVetProfile(
  userId: string,
  patch: Partial<VetProfile>
): Promise<VetProfile> {
  return patchJson<VetProfile>(`/api/users/${userId}/vet-profile`, patch);
}
