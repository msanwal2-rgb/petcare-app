/**
 * Zod schemas — the single validation boundary for every write endpoint and
 * for search query parsing. Keeps invalid data out of the database and mirrors
 * the union types in /types so the API can't drift from the contract.
 */

import { z } from "zod";

export const userRole = z.enum(["owner", "caretaker", "vet"]);
const species = z.enum(["dog", "cat", "other"]);
const sex = z.enum(["male", "female"]);
const serviceType = z.enum(["walking", "sitting", "boarding", "daycare"]);
const pricingUnit = z.enum(["hour", "day"]);
const backgroundCheckStatus = z.enum(["verified", "pending", "none"]);
const bookingStatus = z.enum([
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

export const reviewKind = z.enum(["booking", "vet_appointment"]);

export const createReviewSchema = z.object({
  fromUserId: z.string(),
  toUserId: z.string(),
  rating: z.number().min(0).max(5),
  comment: z.string(),
});

/* ── Notifications ──────────────────────────────────────────────────── */

/** Omit `id` to mark everything read. */
export const markReadSchema = z.object({ id: z.string().optional() });

/* ── Query-string coercion ──────────────────────────────────────────────
   Query params arrive as strings; these turn them back into the types the
   search functions expect, failing loudly on garbage rather than silently
   producing NaN. */

const numeric = z
  .string()
  .transform((v) => Number(v))
  .refine((n) => !Number.isNaN(n), "must be a number");

const boolish = z
  .string()
  .transform((v) => v === "true" || v === "1")
  .pipe(z.boolean());

/* ── Vet care ───────────────────────────────────────────────────────── */

const vetSpecialty = z.enum([
  "general",
  "dermatology",
  "dentistry",
  "surgery",
  "emergency",
  "nutrition",
  "behavior",
  "exotics",
]);
const consultMode = z.enum(["in_clinic", "video", "home_visit"]);
const appointmentStatus = z.enum([
  "requested",
  "confirmed",
  "declined",
  "in_progress",
  "completed",
  "cancelled",
]);
const medicalRecordType = z.enum([
  "visit_note",
  "vaccination",
  "prescription",
  "lab_result",
  "weight",
  "allergy",
]);

/**
 * Note what's missing: rating, reviewCount and responseRatePct. Those are
 * derived from real activity, so a vet cannot patch their own reputation.
 */
export const vetPatchSchema = z
  .object({
    bio: z.string(),
    specialties: z.array(vetSpecialty),
    licenseNumber: z.string(),
    licenseState: z.string(),
    yearsExperience: z.number().int().min(0).max(70),
    acceptedSpecies: z.array(species),
    consultModes: z.array(consultMode),
    consultFee: z.number().min(0),
    emergencyAvailable: z.boolean(),
    clinic: z.object({
      name: z.string(),
      city: z.string(),
      state: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
    availability: z.array(availabilityDay),
  })
  .partial();

/** `fee` is absent by design — the server reads it off the vet's profile. */
export const createAppointmentSchema = z.object({
  ownerId: z.string(),
  vetId: z.string(),
  petId: z.string(),
  mode: consultMode,
  reason: z.string().min(1),
  symptoms: z.array(z.string()),
  startDateTime: z.string(),
  endDateTime: z.string(),
  notes: z.string(),
});

export const updateAppointmentStatusSchema = z.object({
  status: appointmentStatus,
});

export const medicalRecordSchema = z.object({
  type: medicalRecordType,
  title: z.string().min(1),
  details: z.string().default(""),
  occurredAt: z.string(),
  appointmentId: z.string().nullable().default(null),
  nextDueAt: z.string().nullable().default(null),
  medicationName: z.string().nullable().default(null),
  dosage: z.string().nullable().default(null),
  refillsLeft: z.number().int().min(0).nullable().default(null),
  expiresAt: z.string().nullable().default(null),
  productSlugs: z.array(z.string()).default([]),
});

export const vetSearchQuerySchema = z.object({
  location: z.string().optional(),
  lat: numeric.optional(),
  lng: numeric.optional(),
  radiusMiles: numeric.optional(),
  specialty: vetSpecialty.optional(),
  species: species.optional(),
  mode: consultMode.optional(),
  emergencyOnly: boolish.optional(),
});

/* ── Store ──────────────────────────────────────────────────────────── */

const productCategory = z.enum([
  "dry_food",
  "wet_food",
  "treats",
  "supplements",
  "prescription_diet",
  "dental",
  "accessories",
]);
const lifeStage = z.enum(["puppy", "kitten", "adult", "senior", "all"]);
const productSort = z.enum([
  "featured",
  "price_asc",
  "price_desc",
  "rating",
  "newest",
]);
const orderStatus = z.enum([
  "pending_payment",
  "paid",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "refunded",
]);

const intish = numeric.pipe(z.number().int());

export const productQuerySchema = z.object({
  q: z.string().optional(),
  category: productCategory.optional(),
  species: species.optional(),
  lifeStage: lifeStage.optional(),
  brand: z.string().optional(),
  minPriceCents: intish.optional(),
  maxPriceCents: intish.optional(),
  sort: productSort.optional(),
  limit: intish.optional(),
  offset: intish.optional(),
});

const shippingAddressSchema = z.object({
  name: z.string().min(1, "Who should we address it to?"),
  line1: z.string().min(1, "Street address is required"),
  line2: z.string().default(""),
  city: z.string().min(1, "City is required"),
  state: z.string().min(1, "State is required"),
  postalCode: z.string().min(3, "Postal code is required"),
  country: z.string().default("US"),
  phone: z.string().default(""),
});

const cartLine = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(20),
});

export const createOrderSchema = z.object({
  items: z.array(cartLine).min(1),
  shippingAddress: shippingAddressSchema,
  deliveryInstructions: z.string().optional(),
  /** Enables the prescription check for Rx-only items. */
  petId: z.string().optional(),
});

/** Cart re-pricing, used by the cart and checkout screens before submitting. */
export const quoteCartSchema = z.object({
  items: z.array(cartLine),
  petId: z.string().optional(),
});

export const updateOrderStatusSchema = z.object({
  status: orderStatus,
  location: z.string().optional(),
  carrier: z.string().optional(),
  trackingNumber: z.string().optional(),
});

/* ── Search query parsing ───────────────────────────────────────────── */

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

export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type PetInputBody = z.infer<typeof petInputSchema>;
export type PetPatchBody = z.infer<typeof petPatchSchema>;
export type CaretakerPatchBody = z.infer<typeof caretakerPatchSchema>;
export type CreateBookingBody = z.infer<typeof createBookingSchema>;
export type CreateReviewBody = z.infer<typeof createReviewSchema>;
export type VetPatchBody = z.infer<typeof vetPatchSchema>;
export type CreateAppointmentBody = z.infer<typeof createAppointmentSchema>;
export type MedicalRecordBody = z.infer<typeof medicalRecordSchema>;
export type ProductQueryBody = z.infer<typeof productQuerySchema>;
export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type QuoteCartBody = z.infer<typeof quoteCartSchema>;
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusSchema>;
