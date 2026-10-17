import type { PublicUser, ShelterProfile, Species } from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/**
 * Shelters — API client. Pages import ONLY from here.
 *
 * Shaped like `api/vets.ts`: the profile and the public projection of the
 * account behind it arrive side by side, and the search is cursor-paged.
 */

/** A shelter joined to its public account and how many animals it has available. */
export interface ShelterWithUser {
  profile: ShelterProfile;
  user: PublicUser;
  availableCount: number;
  /** Straight-line miles to the shelter, when the search gave an origin. */
  distanceMiles: number | null;
}

export interface ShelterSearchPage {
  items: ShelterWithUser[];
  nextCursor: string | null;
}

export interface ShelterSearchParams {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  species?: Species;
  kind?: string;
  withAvailable?: boolean;
  verifiedOnly?: boolean;
  cursor?: string;
  limit?: number;
}

/** GET /shelters/search -> one page. */
export function searchShelters(params: ShelterSearchParams = {}): Promise<ShelterSearchPage> {
  return getJson<ShelterSearchPage>(`/shelters/search${qs(params as Record<string, unknown>)}`);
}

/** GET /shelters/:id -> the shelter page's data, or null. */
export function getShelterById(id: string): Promise<ShelterWithUser | null> {
  return getJsonOrNull<ShelterWithUser>(`/shelters/${id}`);
}

/** GET /users/:id/shelter-profile -> null when they have none. */
export function getShelterByUserId(userId: string): Promise<ShelterProfile | null> {
  return getJsonOrNull<ShelterProfile>(`/users/${userId}/shelter-profile`);
}

/** What a shelter may set about itself. Verification and response rate are not on the list. */
export type ShelterPatch = Partial<
  Omit<ShelterProfile, "id" | "userId" | "verificationStatus" | "responseRatePct" | "createdAt">
>;

/** PATCH /users/:id/shelter-profile -> ShelterProfile (create or edit). */
export function upsertShelterProfile(userId: string, patch: ShelterPatch): Promise<ShelterProfile> {
  return patchJson<ShelterProfile>(`/users/${userId}/shelter-profile`, patch);
}
