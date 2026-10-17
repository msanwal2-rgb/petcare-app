import type {
  AdoptionApplication,
  AdoptionListing,
  ApplicationStatus,
  EnergyLevel,
  HomeType,
  ListingStatus,
  PaymentStatus,
  Pet,
  PublicUser,
  Species,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson, qs } from "./_client";

/**
 * Adoption — API client. Pages import ONLY from here.
 *
 * The directory and the queues are cursor-paged (REQUIREMENTS.md §2.5). The
 * directory also carries `total`, which the adopt page shows as "N waiting".
 */

/** A listing with the animal it is about — what a card renders. */
export interface AdoptionListingWithPet {
  listing: AdoptionListing;
  pet: Pet;
  shelterName: string;
  /** Miles to where the animal is, when the search gave an origin. */
  distanceMiles: number | null;
}

export interface AdoptionListingPage {
  items: AdoptionListingWithPet[];
  nextCursor: string | null;
  total: number;
}

/** An application as the shelter reviewing it sees it. */
export interface AdoptionApplicationWithApplicant {
  application: AdoptionApplication;
  applicant: PublicUser;
  /** Set once a fee has been charged; null for a waived or unpaid one. */
  paymentStatus: PaymentStatus | null;
}

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
  cursor?: string;
  limit?: number;
}

/** GET /adoptions/listings -> one page of available animals, longest-waiting first. */
export function searchListings(filters: ListingFilters = {}): Promise<AdoptionListingPage> {
  return getJson<AdoptionListingPage>(`/adoptions/listings${qs(filters as Record<string, unknown>)}`);
}

/** GET /adoptions/listings/:id -> null when there is no such (visible) listing. */
export function getListingById(id: string): Promise<AdoptionListingWithPet | null> {
  return getJsonOrNull<AdoptionListingWithPet>(`/adoptions/listings/${id}`);
}

/** POST /adoptions/listings -> a draft listing (201). */
export function createListing(input: {
  petId: string;
  feeCents?: number;
  headline?: string;
  story?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
}): Promise<AdoptionListingWithPet> {
  return postJson<AdoptionListingWithPet>(`/adoptions/listings`, input);
}

/** PATCH /adoptions/listings/:id */
export function updateListing(id: string, patch: Record<string, unknown>): Promise<AdoptionListingWithPet> {
  return patchJson<AdoptionListingWithPet>(`/adoptions/listings/${id}`, patch);
}

/** PATCH /adoptions/listings/:id/status */
export function setListingStatus(id: string, status: ListingStatus): Promise<AdoptionListingWithPet> {
  return patchJson<AdoptionListingWithPet>(`/adoptions/listings/${id}/status`, { status });
}

/* ── Applications ──────────────────────────────────────────────── */

export interface ApplicationPage {
  items: AdoptionApplication[];
  nextCursor: string | null;
}

export interface ShelterQueuePage {
  items: AdoptionApplicationWithApplicant[];
  nextCursor: string | null;
}

/** GET /adoptions/applications -> yours, newest first. */
export function getMyApplications(cursor?: string): Promise<ApplicationPage> {
  return getJson<ApplicationPage>(`/adoptions/applications${qs({ cursor })}`);
}

/** GET /adoptions/applications?as=shelter -> the shelter's queue, oldest first. */
export function getShelterApplications(
  status?: ApplicationStatus,
  cursor?: string,
  limit = 100
): Promise<ShelterQueuePage> {
  return getJson<ShelterQueuePage>(
    `/adoptions/applications${qs({ as: "shelter", status, cursor, limit })}`
  );
}

/** GET /adoptions/applications/:id -> null when it is not yours to see. */
export function getApplicationById(id: string): Promise<AdoptionApplication | null> {
  return getJsonOrNull<AdoptionApplication>(`/adoptions/applications/${id}`);
}

export interface ApplicationInput {
  listingId: string;
  householdAdults: number;
  householdChildren: number;
  hasOtherPets: boolean;
  otherPetsNotes?: string;
  homeType: HomeType;
  fencedYard: boolean;
  ownsHome: boolean;
  hoursAlonePerDay: number;
  experience?: string;
  message?: string;
}

/** POST /adoptions/applications -> AdoptionApplication (201). */
export function applyToAdopt(input: ApplicationInput): Promise<AdoptionApplication> {
  return postJson<AdoptionApplication>(`/adoptions/applications`, input);
}

/** PATCH /adoptions/applications/:id/status */
export function setApplicationStatus(
  id: string,
  status: "under_review" | "approved" | "rejected" | "withdrawn",
  note?: string
): Promise<AdoptionApplication> {
  return patchJson<AdoptionApplication>(`/adoptions/applications/${id}/status`, { status, note });
}

export interface AdoptionPayment {
  payment: { ref: string; clientSecret: string | null; provider: string };
  status: PaymentStatus;
}

/** POST /adoptions/applications/:id/payment -> the fee's payment handoff. */
export function payAdoptionFee(id: string): Promise<AdoptionPayment> {
  return postJson<AdoptionPayment>(`/adoptions/applications/${id}/payment`, {});
}

/**
 * POST /adoptions/applications/:id/complete -> { application, pet }
 *
 * `force` cancels any live booking or appointment standing in the way. Never
 * send it without showing the person what it will cancel first.
 */
export function completeAdoption(
  id: string,
  force = false
): Promise<{ application: AdoptionApplication; pet: Pet }> {
  return postJson(`/adoptions/applications/${id}/complete`, { force });
}
