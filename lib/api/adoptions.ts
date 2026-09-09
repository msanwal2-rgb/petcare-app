/**
 * Adoption — API client. See ./orders.ts for the conventions this follows.
 */

import { getJson, getJsonOrNull, patchJson, postJson, qs } from "./_client";
import type {
  AdoptionApplication,
  AdoptionApplicationWithApplicant,
  AdoptionListingPage,
  AdoptionListingWithPet,
  ApplicationStatus,
  EnergyLevel,
  ListingStatus,
  Pet,
  Species,
} from "@/types";

export interface ListingFilters {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  species?: Species;
  shelterId?: string;
  goodWithKids?: "yes";
  goodWithDogs?: "yes";
  goodWithCats?: "yes";
  energyLevel?: EnergyLevel;
  maxFeeCents?: number;
  q?: string;
  limit?: number;
  offset?: number;
}

/** GET /api/adoptions/listings -> AdoptionListingPage */
export async function searchListings(
  filters: ListingFilters = {}
): Promise<AdoptionListingPage> {
  return getJson<AdoptionListingPage>(
    `/api/adoptions/listings${qs({ ...filters })}`
  );
}

/** GET /api/adoptions/listings/:id -> AdoptionListingWithPet | null(404) */
export async function getListingById(
  id: string
): Promise<AdoptionListingWithPet | null> {
  return getJsonOrNull<AdoptionListingWithPet>(`/api/adoptions/listings/${id}`);
}

/** POST /api/adoptions/listings -> AdoptionListingWithPet (201) */
export async function createListing(input: {
  petId: string;
  feeCents?: number;
  headline?: string;
  story?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}): Promise<AdoptionListingWithPet> {
  return postJson<AdoptionListingWithPet>(`/api/adoptions/listings`, input);
}

/** PATCH /api/adoptions/listings/:id -> AdoptionListingWithPet */
export async function updateListing(
  id: string,
  patch: Record<string, unknown>
): Promise<AdoptionListingWithPet> {
  return patchJson<AdoptionListingWithPet>(`/api/adoptions/listings/${id}`, patch);
}

/** PATCH /api/adoptions/listings/:id/status -> AdoptionListingWithPet */
export async function setListingStatus(
  id: string,
  status: ListingStatus
): Promise<AdoptionListingWithPet> {
  return patchJson<AdoptionListingWithPet>(
    `/api/adoptions/listings/${id}/status`,
    { status }
  );
}

/* ── Applications ──────────────────────────────────────────────── */

/** GET /api/adoptions/applications -> AdoptionApplication[] — yours. */
export async function getMyApplications(): Promise<AdoptionApplication[]> {
  return getJson<AdoptionApplication[]>(`/api/adoptions/applications`);
}

/** GET /api/adoptions/applications?as=shelter -> the shelter's queue. */
export async function getShelterApplications(
  status?: ApplicationStatus
): Promise<AdoptionApplicationWithApplicant[]> {
  return getJson<AdoptionApplicationWithApplicant[]>(
    `/api/adoptions/applications${qs({ as: "shelter", status })}`
  );
}

/** GET /api/adoptions/applications/:id -> AdoptionApplication | null(404) */
export async function getApplicationById(
  id: string
): Promise<AdoptionApplication | null> {
  return getJsonOrNull<AdoptionApplication>(`/api/adoptions/applications/${id}`);
}

export interface ApplicationInput {
  listingId: string;
  householdAdults: number;
  householdChildren: number;
  hasOtherPets: boolean;
  otherPetsNotes?: string;
  homeType: "house" | "apartment" | "condo" | "other";
  fencedYard: boolean;
  ownsHome: boolean;
  hoursAlonePerDay: number;
  experience?: string;
  message?: string;
}

/** POST /api/adoptions/applications -> AdoptionApplication (201) */
export async function applyToAdopt(
  input: ApplicationInput
): Promise<AdoptionApplication> {
  return postJson<AdoptionApplication>(`/api/adoptions/applications`, input);
}

/** PATCH /api/adoptions/applications/:id/status -> AdoptionApplication */
export async function setApplicationStatus(
  id: string,
  status: "under_review" | "approved" | "rejected" | "withdrawn",
  note?: string
): Promise<AdoptionApplication> {
  return patchJson<AdoptionApplication>(
    `/api/adoptions/applications/${id}/status`,
    { status, note }
  );
}

/** POST /api/adoptions/applications/:id/payment -> the adoption fee intent. */
export async function payAdoptionFee(id: string): Promise<{
  payment: { ref: string; clientSecret: string | null; provider: string };
  status: string;
}> {
  return postJson(`/api/adoptions/applications/${id}/payment`, {});
}

/**
 * POST /api/adoptions/applications/:id/complete -> { application, pet }
 *
 * `force` cancels any live booking or appointment standing in the way. Never
 * send it without showing the person what it will cancel first.
 */
export async function completeAdoption(
  id: string,
  force = false
): Promise<{ application: AdoptionApplication; pet: Pet }> {
  return postJson(`/api/adoptions/applications/${id}/complete`, { force });
}
