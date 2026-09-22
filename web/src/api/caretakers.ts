import type {
  AvailabilityDay,
  BackgroundCheckStatus,
  CaretakerProfile,
  PricingEntry,
  PublicUser,
  Review,
  ServiceType,
  Species,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/**
 * Caretakers — API client. Pages import ONLY from here.
 *
 * ── The search is paginated, and the cursor is opaque ──
 *
 * `nextCursor` comes back from the server and goes out again unchanged. It
 * encodes the sort key of the last row on the page, so a client that tried to
 * read it would be coupled to a sort order that changes with the filter. Treat
 * it as a token: hold it, send it back, discard it when it is null.
 */

/** A caretaker joined to the public projection of the person behind it. */
export interface CaretakerWithUser {
  profile: CaretakerProfile;
  user: PublicUser;
  priceRange: { min: number; max: number };
  /** Straight-line miles from the searched point, when one was given. */
  distanceMiles: number | null;
}

export interface CaretakerSearchPage {
  items: CaretakerWithUser[];
  /** null at the end of the results. */
  nextCursor: string | null;
}

export interface CaretakerSearchParams {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  serviceType?: ServiceType;
  species?: Species;
  /** ISO date — "available on or after this". */
  startDate?: string;
  minPrice?: number;
  maxPrice?: number;
  cursor?: string;
  limit?: number;
}

/** GET /caretakers/search -> one page, filtered and sorted in PostgreSQL. */
export function searchCaretakers(
  params: CaretakerSearchParams = {},
): Promise<CaretakerSearchPage> {
  return getJson<CaretakerSearchPage>(
    `/caretakers/search${qs(params as Record<string, unknown>)}`,
  );
}

/** GET /caretakers/:id -> the profile page's data, or null. */
export function getCaretaker(id: string): Promise<CaretakerWithUser | null> {
  return getJsonOrNull<CaretakerWithUser>(`/caretakers/${id}`);
}

/** GET /users/:id/caretaker-profile -> null when they are not a caretaker. */
export function getCaretakerProfileForUser(
  userId: string,
): Promise<CaretakerProfile | null> {
  return getJsonOrNull<CaretakerProfile>(`/users/${userId}/caretaker-profile`);
}

/**
 * What a caretaker may change about themselves.
 *
 * No `rating`, no `reviewCount`, no `responseRatePct`: all three are derived
 * from the caretaker's actual history, and the server has nowhere to put them
 * even if this sent them.
 *
 * `pricing` and `availability` are **replace-whole**. Sending either swaps the
 * entire set; omitting it leaves the stored one untouched.
 */
export interface CaretakerProfilePatch {
  bio?: string;
  servicesOffered?: ServiceType[];
  pricing?: PricingEntry[];
  serviceRadiusMiles?: number;
  acceptedSpecies?: Species[];
  homeEnvironment?: {
    fencedYard: boolean;
    hasOtherPets: boolean;
    smokeFree: boolean;
  };
  certifications?: string[];
  backgroundCheckStatus?: BackgroundCheckStatus;
  availability?: AvailabilityDay[];
}

/** PATCH /users/:id/caretaker-profile -> creates it if there is none yet. */
export function saveCaretakerProfile(
  userId: string,
  patch: CaretakerProfilePatch,
): Promise<CaretakerProfile> {
  return patchJson<CaretakerProfile>(`/users/${userId}/caretaker-profile`, patch);
}

/** GET /users/:id/reviews -> reviews **about** this person. Public. */
export function getReviewsForUser(
  userId: string,
  kind?: "booking" | "vet_appointment",
): Promise<Review[]> {
  return getJson<Review[]>(`/users/${userId}/reviews${qs({ kind })}`);
}
