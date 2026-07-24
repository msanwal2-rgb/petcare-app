/**
 * Domain models for the Pet Care Marketplace (brief §4).
 * These mirror exactly what the backend will return, so the same
 * types are used by the mock data layer today and the real API later.
 */

export type UserRole = "owner" | "caretaker";

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  avatarUrl: string;
  roles: UserRole[]; // a user can be both owner and caretaker
  address: { city: string; state: string; lat: number; lng: number };
  verified: boolean;
  createdAt: string; // ISO 8601
}

export type Species = "dog" | "cat" | "other";
export type Sex = "male" | "female";

export interface Pet {
  id: string;
  ownerId: string;
  name: string;
  species: Species;
  breed: string;
  sex: Sex;
  dob: string; // ISO date
  weightLbs: number;
  photoUrl: string;
  vaccinated: boolean;
  allergies: string[];
  medications: string[];
  behaviorNotes: string;
  feedingInstructions: string;
  vetContact: { name: string; phone: string };
}

export type ServiceType = "walking" | "sitting" | "boarding" | "daycare";
export type PricingUnit = "hour" | "day";
export type BackgroundCheckStatus = "verified" | "pending" | "none";

export interface PricingEntry {
  serviceType: ServiceType;
  unit: PricingUnit;
  rate: number; // USD
}

export interface AvailabilityDay {
  date: string; // ISO date, e.g. 2026-07-10
  slots: { start: string; end: string }[]; // "09:00" / "17:00"
}

export interface CaretakerProfile {
  id: string;
  userId: string;
  bio: string;
  servicesOffered: ServiceType[];
  pricing: PricingEntry[];
  serviceRadiusMiles: number;
  acceptedSpecies: Species[];
  homeEnvironment: {
    fencedYard: boolean;
    hasOtherPets: boolean;
    smokeFree: boolean;
  };
  certifications: string[];
  backgroundCheckStatus: BackgroundCheckStatus;
  rating: number; // 0–5
  reviewCount: number;
  responseRatePct: number; // 0–100
  availability: AvailabilityDay[];
}

export type BookingStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Booking {
  id: string;
  ownerId: string;
  caretakerId: string; // CaretakerProfile.id
  petIds: string[];
  serviceType: ServiceType;
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  notes: string;
  status: BookingStatus;
  priceTotal: number; // USD
  createdAt: string; // ISO 8601
}

export interface Review {
  id: string;
  bookingId: string;
  fromUserId: string;
  toUserId: string;
  rating: number; // 0–5
  comment: string;
  createdAt: string; // ISO 8601
}

/* ── Request/params shapes used by the data layer (brief §7) ──── */

export interface SearchParams {
  /** Free-text location label shown in the UI (e.g. "Austin, TX"). */
  location?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  serviceType?: ServiceType;
  species?: Species;
  startDate?: string; // ISO date
  endDate?: string; // ISO date
  minPrice?: number;
  maxPrice?: number;
}

/**
 * A caretaker joined with its owning User — the denormalized shape
 * that search results and profile pages actually render.
 */
export interface CaretakerWithUser extends CaretakerProfile {
  user: User;
  /** Straight-line miles from the searched location, when available. */
  distanceMiles?: number;
  priceRange: { min: number; max: number };
}

export interface CreateBookingInput {
  ownerId: string;
  caretakerId: string;
  petIds: string[];
  serviceType: ServiceType;
  startDateTime: string;
  endDateTime: string;
  notes: string;
  priceTotal: number;
}
