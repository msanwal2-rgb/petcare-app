/**
 * Zod schemas — the single validation boundary for every write endpoint and
 * for search query parsing. Keeps invalid data out of the database and mirrors
 * the union types in /types so the API can't drift from the contract.
 */

import { z } from "zod";

export const userRole = z.enum(["owner", "caretaker", "vet", "shelter"]);
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

/**
 * What a user may change about their own account.
 *
 * `PATCH /api/users/:id` checks only that you are patching yourself and then
 * spreads the result straight into `prisma.user.update`, so this schema *is*
 * the privilege boundary. Two fields were removed from it:
 *
 *  - `verified` — the email-verification flag. Self-settable, it made the whole
 *    token flow decorative: anyone could PATCH themselves verified, and the
 *    badge the UI shows next to a name meant nothing. It is now set by
 *    confirming a token, or by an admin, and both are recorded.
 *  - `email` — the identifier the account is keyed and recovered by. Changing
 *    it needs re-verification of the new address rather than a PATCH, and a
 *    duplicate surfaced as an unhandled Prisma P2002, i.e. a 500. That flow
 *    does not exist yet; accepting the field here pretended it did.
 *
 * `roles` deliberately stays. Choosing "I have a pet" / "I care for pets" /
 * "I'm a veterinarian" is what /onboarding is, and self-declaration is the
 * intended design — what a professional claim is *worth* is decided by
 * verification (`backgroundCheckStatus`, license review) in the admin console,
 * not by who is allowed to tick the box.
 */
export const updateUserSchema = z
  .object({
    name: z.string().min(1),
    phone: z.string(),
    avatarUrl: z.string(),
    roles: z.array(userRole),
    address: address,
  })
  .partial();

/* ── Pets ───────────────────────────────────────────────────────────── */

const vetContact = z.object({ name: z.string(), phone: z.string() });

/**
 * No `ownerId`.
 *
 * It used to be here, and `updatePet` used to write it, and `PATCH /api/pets/:id`
 * checked only that the caller was the *outgoing* owner — so any user could hand
 * an animal to any user id, with no consent from the recipient, no audit, no
 * notification, and no check that the recipient existed. `PetForm` made it worse
 * by spreading `ownerId` into every edit payload, so a stale prop could rewrite
 * ownership silently.
 *
 * Who owns an animal now changes in exactly one place: completing an adoption
 * (`lib/server/adoptions/transfer.ts`), which also moves `ownedSince` and so
 * severs the previous owner's caretakers and vets in the same write.
 *
 * `.strict()` rather than Zod's default key-stripping, so a client still sending
 * the old shape gets a loud 400 instead of a silent no-op.
 */
export const petInputSchema = z
  .object({
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
  })
  .strict();

/** Derived, so `ownerId` cannot creep back onto one side and not the other. */
export const petPatchSchema = petInputSchema.partial().strict();

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

/**
 * Note the absence of `priceTotal`.
 *
 * It used to be here as a bare `z.number()`, spread straight into
 * `prisma.booking.create` — so a booking could be created for $0, or for a
 * negative amount, by anyone willing to edit a request body. It was harmless
 * only because nothing charged for a booking, which is not a property worth
 * relying on. The server now reads the caretaker's own rate and multiplies it
 * by the duration, exactly as `createAppointment` has always taken the vet's
 * fee from the vet's profile rather than the request.
 */
export const createBookingSchema = z.object({
  ownerId: z.string(),
  caretakerId: z.string(),
  petIds: z.array(z.string()).min(1).max(10),
  serviceType: serviceType,
  startDateTime: z.string(),
  endDateTime: z.string(),
  notes: z.string().max(2000),
});

export const updateBookingStatusSchema = z.object({ status: bookingStatus });

/* Query strings arrive as strings. These coerce them into the shapes the
   search functions expect, failing loudly on garbage rather than silently
   producing NaN. Declared here because the shelter and adoption schemas below
   use them too. */

const numeric = z
  .string()
  .transform((v) => Number(v))
  .refine((n) => !Number.isNaN(n), "must be a number");

const boolish = z
  .string()
  .transform((v) => v === "true" || v === "1")
  .pipe(z.boolean());

/* ── Shelters ───────────────────────────────────────────────────────── */

export const shelterKind = z.enum([
  "municipal",
  "rescue",
  "sanctuary",
  "foster_network",
]);

const shelterAddress = z.object({
  line: z.string(),
  city: z.string(),
  state: z.string(),
  lat: z.number(),
  lng: z.number(),
});

/**
 * Note what is absent, by the same rule that keeps `rating` out of
 * `vetPatchSchema`: `verificationStatus` is decided by a person in the admin
 * console, and `responseRatePct` is computed from application statuses. A
 * profile form that could set either would make both meaningless.
 */
export const shelterPatchSchema = z
  .object({
    name: z.string().min(1).max(120),
    bio: z.string().max(4000),
    kind: shelterKind,
    registrationNumber: z.string().max(60),
    registrationState: z.string().max(60),
    acceptedSpecies: z.array(species),
    websiteUrl: z.string().max(300),
    phone: z.string().max(40),
    email: z.string().max(200),
    address: shelterAddress,
    adoptionPolicy: z.string().max(4000),
  })
  .partial();
export type ShelterPatchBody = z.infer<typeof shelterPatchSchema>;

export const shelterSearchQuerySchema = z.object({
  lat: numeric.optional(),
  lng: numeric.optional(),
  radiusMiles: numeric.optional(),
  species: species.optional(),
  kind: shelterKind.optional(),
  withAvailable: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  verifiedOnly: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

/* ── Adoption ───────────────────────────────────────────────────────── */

export const listingStatus = z.enum([
  "draft",
  "available",
  "pending",
  "adopted",
  "withdrawn",
]);
export const triState = z.enum(["yes", "no", "unknown"]);
export const energyLevel = z.enum(["low", "moderate", "high"]);

/** No `status` — a listing moves through its own endpoint, not a patch. */
export const adoptionListingSchema = z
  .object({
    petId: z.string(),
    feeCents: z.number().int().min(0).max(1_000_000),
    headline: z.string().max(200),
    story: z.string().max(8000),
    goodWithKids: triState,
    goodWithDogs: triState,
    goodWithCats: triState,
    houseTrained: triState,
    energyLevel: energyLevel,
    specialNeeds: z.boolean(),
    specialNeedsNotes: z.string().max(2000),
    spayedNeutered: z.boolean(),
    microchipped: z.boolean(),
    city: z.string().min(1),
    state: z.string().min(1),
    lat: z.number(),
    lng: z.number(),
    intakeAt: z.string(),
  })
  .partial({
    feeCents: true,
    headline: true,
    story: true,
    goodWithKids: true,
    goodWithDogs: true,
    goodWithCats: true,
    houseTrained: true,
    energyLevel: true,
    specialNeeds: true,
    specialNeedsNotes: true,
    spayedNeutered: true,
    microchipped: true,
    intakeAt: true,
  });
export type AdoptionListingBody = z.infer<typeof adoptionListingSchema>;

export const adoptionListingPatchSchema = adoptionListingSchema
  .partial()
  .omit({ petId: true });

export const listingStatusSchema = z.object({ status: listingStatus });

export const adoptionListingQuerySchema = z.object({
  lat: numeric.optional(),
  lng: numeric.optional(),
  radiusMiles: numeric.optional(),
  species: species.optional(),
  shelterId: z.string().optional(),
  goodWithKids: z.literal("yes").optional(),
  goodWithDogs: z.literal("yes").optional(),
  goodWithCats: z.literal("yes").optional(),
  energyLevel: energyLevel.optional(),
  maxFeeCents: numeric.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: numeric.optional(),
  offset: numeric.optional(),
});
export type AdoptionListingQuery = z.infer<typeof adoptionListingQuerySchema>;

/** No `applicantId` — it is the caller, taken from the session. */
export const adoptionApplicationSchema = z.object({
  listingId: z.string(),
  householdAdults: z.number().int().min(1).max(20),
  householdChildren: z.number().int().min(0).max(20),
  hasOtherPets: z.boolean(),
  otherPetsNotes: z.string().max(2000).optional(),
  homeType: z.enum(["house", "apartment", "condo", "other"]),
  fencedYard: z.boolean(),
  ownsHome: z.boolean(),
  hoursAlonePerDay: z.number().int().min(0).max(24),
  experience: z.string().max(4000).optional(),
  message: z.string().max(4000).optional(),
});
export type AdoptionApplicationBody = z.infer<typeof adoptionApplicationSchema>;

export const applicationStatusSchema = z.object({
  status: z.enum([
    "under_review",
    "approved",
    "rejected",
    "withdrawn",
  ]),
  note: z.string().max(1000).optional(),
});

export const completeAdoptionSchema = z.object({
  /**
   * Cancel any live booking or appointment standing in the way.
   *
   * Off by default: cancelling a sitter's booking out from under them, while
   * the animal is in their house, from a flow they are not party to, is worse
   * than refusing to complete. The UI names the engagements first.
   */
  force: z.boolean().optional(),
});

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
/**
 * No `ownerId`. It is the caller's own id, taken from the session and passed to
 * `createAppointment` as an argument — the same shape `createOrder` uses. It
 * used to arrive in the body with the route checking it matched, which worked
 * but meant a security-relevant equality lived in a handler rather than the
 * domain. That identity now selects a price, so the check has to be somewhere
 * a future route cannot forget it.
 */
export const createAppointmentSchema = z.object({
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

/* ── Support assistant ───────────────────────────────────────────────── */

/**
 * The chat request body.
 *
 * Only the HTTP boundary is validated here. The assistant's *tool* schemas live
 * beside the tools in lib/server/assistant/tools/, because a tool's
 * `inputSchema` is not a request boundary — it is a model-facing contract whose
 * `.describe()` text is prompt content, and splitting it from the tool it
 * documents makes both harder to read.
 *
 * The caps are the first line of cost control: a request cannot arrive carrying
 * a hundred turns of history or a novel as its question.
 */
export const assistantChatSchema = z.object({
  /**
   * UIMessage shapes are the AI SDK's, and they evolve with it, so they are
   * checked structurally rather than mirrored field for field — pinning the
   * full shape here would break on an SDK upgrade without making anything
   * safer. What matters at this boundary is the count and the size, both of
   * which are enforced.
   */
  messages: z
    .array(
      z
        .object({
          id: z.string().optional(),
          role: z.enum(["user", "assistant", "system"]),
          parts: z.array(z.object({ type: z.string() }).loose()).max(50),
        })
        .loose(),
    )
    .min(1)
    .max(40),
  conversationId: z.string().max(64).optional(),
  /** The page the customer is on, so "cancel this" has a referent. */
  path: z.string().max(512).optional(),
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
export type AssistantChatBody = z.infer<typeof assistantChatSchema>;
