/**
 * Row → API-shape serializers.
 *
 * The database stores a flat, normalized form; the frontend `/types` expect a
 * denormalized shape (nested address, vetContact, homeEnvironment, computed
 * priceRange/distanceMiles). Every server domain function returns values mapped
 * through here, so the HTTP responses are byte-compatible with what the mock
 * used to return.
 */

import type {
  AvailabilityDay as DbAvailabilityDay,
  Booking as DbBooking,
  CaretakerProfile as DbCaretaker,
  Pet as DbPet,
  PricingEntry as DbPricingEntry,
  Review as DbReview,
  User as DbUser,
} from "@prisma/client";
import type {
  AvailabilityDay,
  Booking,
  CaretakerProfile,
  CaretakerWithUser,
  Pet,
  PricingEntry,
  Review,
  Species,
  ServiceType,
  Sex,
  User,
  UserRole,
  BackgroundCheckStatus,
  PricingUnit,
  BookingStatus,
} from "@/types";
import { distanceMiles } from "@/lib/utils";

export function toUser(u: DbUser): User {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    roles: u.roles as UserRole[],
    address: {
      city: u.addressCity,
      state: u.addressState,
      lat: u.lat,
      lng: u.lng,
    },
    verified: u.verified,
    createdAt: u.createdAt,
  };
}

export function toPet(p: DbPet): Pet {
  return {
    id: p.id,
    ownerId: p.ownerId,
    name: p.name,
    species: p.species as Species,
    breed: p.breed,
    sex: p.sex as Sex,
    dob: p.dob,
    weightLbs: p.weightLbs,
    photoUrl: p.photoUrl,
    vaccinated: p.vaccinated,
    allergies: p.allergies,
    medications: p.medications,
    behaviorNotes: p.behaviorNotes,
    feedingInstructions: p.feedingInstructions,
    vetContact: { name: p.vetName, phone: p.vetPhone },
  };
}

function toPricing(rows: DbPricingEntry[]): PricingEntry[] {
  return rows.map((r) => ({
    serviceType: r.serviceType as ServiceType,
    unit: r.unit as PricingUnit,
    rate: r.rate,
  }));
}

function toAvailability(rows: DbAvailabilityDay[]): AvailabilityDay[] {
  return rows
    .map((r) => ({
      date: r.date,
      slots: (r.slots as { start: string; end: string }[]) ?? [],
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

type DbCaretakerWithRelations = DbCaretaker & {
  pricing: DbPricingEntry[];
  availability: DbAvailabilityDay[];
};

export function toCaretakerProfile(c: DbCaretakerWithRelations): CaretakerProfile {
  return {
    id: c.id,
    userId: c.userId,
    bio: c.bio,
    servicesOffered: c.servicesOffered as ServiceType[],
    pricing: toPricing(c.pricing),
    serviceRadiusMiles: c.serviceRadiusMiles,
    acceptedSpecies: c.acceptedSpecies as Species[],
    homeEnvironment: {
      fencedYard: c.fencedYard,
      hasOtherPets: c.hasOtherPets,
      smokeFree: c.smokeFree,
    },
    certifications: c.certifications,
    backgroundCheckStatus: c.backgroundCheckStatus as BackgroundCheckStatus,
    rating: c.rating,
    reviewCount: c.reviewCount,
    responseRatePct: c.responseRatePct,
    availability: toAvailability(c.availability),
  };
}

function priceRange(pricing: PricingEntry[]): { min: number; max: number } {
  const rates = pricing.map((p) => p.rate);
  return rates.length
    ? { min: Math.min(...rates), max: Math.max(...rates) }
    : { min: 0, max: 0 };
}

export function toCaretakerWithUser(
  c: DbCaretakerWithRelations & { user: DbUser },
  origin?: { lat: number; lng: number }
): CaretakerWithUser {
  const profile = toCaretakerProfile(c);
  const user = toUser(c.user);
  return {
    ...profile,
    user,
    priceRange: priceRange(profile.pricing),
    distanceMiles: origin ? distanceMiles(origin, user.address) : undefined,
  };
}

export function toBooking(b: DbBooking): Booking {
  return {
    id: b.id,
    ownerId: b.ownerId,
    caretakerId: b.caretakerId,
    petIds: b.petIds,
    serviceType: b.serviceType as ServiceType,
    startDateTime: b.startDateTime,
    endDateTime: b.endDateTime,
    notes: b.notes,
    status: b.status as BookingStatus,
    priceTotal: b.priceTotal,
    createdAt: b.createdAt,
  };
}

export function toReview(r: DbReview): Review {
  return {
    id: r.id,
    bookingId: r.bookingId,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
  };
}
