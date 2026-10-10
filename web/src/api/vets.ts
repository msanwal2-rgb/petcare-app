import type {
  AvailabilityDay,
  ConsultMode,
  PublicUser,
  Review,
  Species,
  VetProfile,
  VetSpecialty,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/**
 * Vets — API client. Pages import ONLY from here.
 *
 * Shaped like `api/caretakers.ts`, because the two are the same kind of thing.
 * The search is paginated and the cursor is opaque: `nextCursor` comes back
 * from the server and goes out again unchanged. It encodes the sort key of the
 * last row, and the sort changes with the filter — nearest first when a
 * location is given, best rated otherwise — so a client that tried to read it
 * would break the first time somebody searched differently.
 */

/** A vet joined to the public projection of the person behind it. */
export interface VetWithUser {
  profile: VetProfile;
  user: PublicUser;
  /** Straight-line miles to the **clinic**, when the search gave an origin. */
  distanceMiles: number | null;
}

export interface VetSearchPage {
  items: VetWithUser[];
  /** null at the end of the results. */
  nextCursor: string | null;
}

export interface VetSearchParams {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  specialty?: VetSpecialty;
  species?: Species;
  mode?: ConsultMode;
  emergencyOnly?: boolean;
  cursor?: string;
  limit?: number;
}

/** GET /vets/search -> one page, filtered and sorted in PostgreSQL. */
export function searchVets(params: VetSearchParams = {}): Promise<VetSearchPage> {
  return getJson<VetSearchPage>(`/vets/search${qs(params as Record<string, unknown>)}`);
}

/** GET /vets/:id -> the profile page's data, or null. */
export function getVet(id: string): Promise<VetWithUser | null> {
  return getJsonOrNull<VetWithUser>(`/vets/${id}`);
}

/** GET /users/:id/vet-profile -> null when they are not a vet. */
export function getVetProfileForUser(userId: string): Promise<VetProfile | null> {
  return getJsonOrNull<VetProfile>(`/users/${userId}/vet-profile`);
}

/**
 * What a vet may change about themselves.
 *
 * No `rating`, `reviewCount` or `responseRatePct` — all three are derived from
 * the clinic's actual history. And no `verificationStatus`: the licence badge
 * is set by staff, which is the only reason it means anything to the owner
 * reading it (REQUIREMENTS.md V11). The server has nowhere to put any of the
 * four even if this sent them.
 *
 * `availability` is **replace-whole**. Sending it swaps the entire calendar;
 * omitting it leaves the stored one untouched.
 */
export interface VetProfilePatch {
  bio?: string;
  specialties?: VetSpecialty[];
  licenseNumber?: string;
  licenseState?: string;
  yearsExperience?: number;
  acceptedSpecies?: Species[];
  consultModes?: ConsultMode[];
  /** USD. The column is integer cents; the crossing happens server-side. */
  consultFee?: number;
  emergencyAvailable?: boolean;
  /** `phone` omitted leaves the stored number alone. */
  clinic?: {
    name: string;
    city: string;
    state: string;
    lat: number;
    lng: number;
    phone?: string;
  };
  availability?: AvailabilityDay[];
}

/** PATCH /users/:id/vet-profile -> creates it if there is none yet. */
export function saveVetProfile(
  userId: string,
  patch: VetProfilePatch,
): Promise<VetProfile> {
  return patchJson<VetProfile>(`/users/${userId}/vet-profile`, patch);
}

/** GET /users/:id/reviews?kind=vet_appointment -> a clinic's reviews. Public. */
export function getVetReviewsForUser(userId: string): Promise<Review[]> {
  return getJson<Review[]>(`/users/${userId}/reviews${qs({ kind: "vet_appointment" })}`);
}
