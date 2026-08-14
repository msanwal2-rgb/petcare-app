/**
 * Zod schemas — the single validation boundary for every write endpoint and
 * for search query parsing. Keeps invalid data out of the database and mirrors
 * the union types in /types so the API can't drift from the contract.
 */

import { z } from "zod";

export const userRole = z.enum(["owner", "caretaker", "vet"]);
export const species = z.enum(["dog", "cat", "other"]);
export const sex = z.enum(["male", "female"]);
export const serviceType = z.enum(["walking", "sitting", "boarding", "daycare"]);
export const pricingUnit = z.enum(["hour", "day"]);
export const backgroundCheckStatus = z.enum(["verified", "pending", "none"]);
export const bookingStatus = z.enum([
  "requested",
  "accepted",
  "declined",
  "in_progress",
  "completed",
  "cancelled",
]);

const address = z.object({
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
});

/* ── Users ──────────────────────────────────────────────────────────── */

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  roles: z.array(userRole).optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string(),
    avatarUrl: z.string(),
    roles: z.array(userRole),
    address: address,
    verified: z.boolean(),
  })
  .partial();

/* ── Pets ───────────────────────────────────────────────────────────── */

const vetContact = z.object({ name: z.string(), phone: z.string() });

export const petInputSchema = z.object({
  ownerId: z.string(),
  name: z.string().min(1),
  species: species,
  breed: z.string(),
  sex: sex,
  dob: z.string(),
  weightLbs: z.number(),
  photoUrl: z.string(),
  vaccinated: z.boolean(),
  allergies: z.array(z.string()),
  medications: z.array(z.string()),
  behaviorNotes: z.string(),
  feedingInstructions: z.string(),
  vetContact: vetContact,
});

export const petPatchSchema = petInputSchema.partial();

/* ── Caretakers ─────────────────────────────────────────────────────── */

const pricingEntry = z.object({
  serviceType: serviceType,
  unit: pricingUnit,
  rate: z.number(),
});

const availabilityDay = z.object({
  date: z.string(),
  slots: z.array(z.object({ start: z.string(), end: z.string() })),
});

export const caretakerPatchSchema = z
  .object({
    bio: z.string(),
    servicesOffered: z.array(serviceType),
    pricing: z.array(pricingEntry),
    serviceRadiusMiles: z.number(),
    acceptedSpecies: z.array(species),
    homeEnvironment: z.object({
      fencedYard: z.boolean(),
      hasOtherPets: z.boolean(),
      smokeFree: z.boolean(),
    }),
    certifications: z.array(z.string()),
    backgroundCheckStatus: backgroundCheckStatus,
    rating: z.number(),
    reviewCount: z.number(),
    responseRatePct: z.number(),
    availability: z.array(availabilityDay),
  })
  .partial();

/* ── Bookings ───────────────────────────────────────────────────────── */

export const createBookingSchema = z.object({
  ownerId: z.string(),
  caretakerId: z.string(),
  petIds: z.array(z.string()).min(1),
  serviceType: serviceType,
  startDateTime: z.string(),
  endDateTime: z.string(),
  notes: z.string(),
  priceTotal: z.number(),
});

export const updateBookingStatusSchema = z.object({ status: bookingStatus });

/* ── Reviews ────────────────────────────────────────────────────────── */

export const createReviewSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  rating: z.number().min(0).max(5),
  comment: z.string(),
});

/* ── Search query parsing ───────────────────────────────────────────── */

const numeric = z
  .string()
  .transform((v) => Number(v))
  .refine((n) => !Number.isNaN(n), "must be a number");

export const searchQuerySchema = z.object({
  location: z.string().optional(),
  lat: numeric.optional(),
  lng: numeric.optional(),
  radiusMiles: numeric.optional(),
  serviceType: serviceType.optional(),
  species: species.optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minPrice: numeric.optional(),
  maxPrice: numeric.optional(),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type PetInputBody = z.infer<typeof petInputSchema>;
export type PetPatchBody = z.infer<typeof petPatchSchema>;
export type CaretakerPatchBody = z.infer<typeof caretakerPatchSchema>;
export type CreateBookingBody = z.infer<typeof createBookingSchema>;
export type CreateReviewBody = z.infer<typeof createReviewSchema>;
