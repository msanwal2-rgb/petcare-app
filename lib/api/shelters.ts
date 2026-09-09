/**
 * Shelters — API client. See ./vets.ts for the pattern this mirrors.
 */

import { getJson, getJsonOrNull, patchJson, qs } from "./_client";
import type { ShelterProfile, ShelterWithUser, Species } from "@/types";

export interface ShelterSearchParams {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  species?: Species;
  kind?: string;
  withAvailable?: boolean;
  verifiedOnly?: boolean;
}

/** GET /api/shelters/search -> ShelterWithUser[] */
export async function searchShelters(
  params: ShelterSearchParams = {}
): Promise<ShelterWithUser[]> {
  return getJson<ShelterWithUser[]>(`/api/shelters/search${qs({ ...params })}`);
}

/** GET /api/shelters/:id -> ShelterWithUser | null(404) */
export async function getShelterById(id: string): Promise<ShelterWithUser | null> {
  return getJsonOrNull<ShelterWithUser>(`/api/shelters/${id}`);
}

/** GET /api/users/:id/shelter-profile -> ShelterProfile | null */
export async function getShelterByUserId(
  userId: string
): Promise<ShelterProfile | null> {
  return getJson<ShelterProfile | null>(`/api/users/${userId}/shelter-profile`);
}

/** PATCH /api/users/:id/shelter-profile -> ShelterProfile (upsert) */
export async function upsertShelterProfile(
  userId: string,
  patch: Partial<Omit<ShelterProfile, "id" | "userId" | "verificationStatus" | "responseRatePct" | "createdAt">>
): Promise<ShelterProfile> {
  return patchJson<ShelterProfile>(`/api/users/${userId}/shelter-profile`, patch);
}
