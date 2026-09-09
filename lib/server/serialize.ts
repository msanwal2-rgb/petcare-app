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
  MedicalRecord as DbMedicalRecord,
  Message as DbMessage,
  Order as DbOrder,
  OrderEvent as DbOrderEvent,
  OrderItem as DbOrderItem,
  Product as DbProduct,
  Pet as DbPet,
  PricingEntry as DbPricingEntry,
  Review as DbReview,
  User as DbUser,
  VetAppointment as DbVetAppointment,
  VetAvailabilityDay as DbVetAvailabilityDay,
  VetProfile as DbVet,
} from "@prisma/client";
import type {
  AppointmentStatus,
  AvailabilityDay,
  Booking,
  CaretakerProfile,
  CaretakerWithUser,
  ConsultMode,
  LifeStage,
  MedicalRecord,
  MedicalRecordType,
  Message,
  Order,
  OrderEvent,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  Pet,
  PricingEntry,
  Product,
  ProductCategory,
  Review,
  ReviewKind,
  Species,
  ServiceType,
  Sex,
  User,
  UserRole,
  VetAppointment,
  VetProfile,
  VetSpecialty,
  VetWithUser,
  BackgroundCheckStatus,
  PricingUnit,
  BookingStatus,
  StaffRole,
  AccountStatus,
  PublicUser,
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
    staffRoles: u.staffRoles as StaffRole[],
    status: u.status as AccountStatus,
  };
}

/**
 * The projection for anyone who isn't the user themselves.
 *
 * `toUser` returns an email address, a phone number and home coordinates. That
 * is the right shape for /api/me and for an admin reading one account; it is
 * the wrong shape for the public profile behind a caretaker card, where ids are
 * guessable and nobody has consented to publishing their address.
 */
export function toPublicUser(u: DbUser): PublicUser {
  return {
    id: u.id,
    name: u.name,
    avatarUrl: u.avatarUrl,
    roles: u.roles as UserRole[],
    address: { city: u.addressCity, state: u.addressState },
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

/** Shared by caretaker and vet availability — identical row shape. */
function toAvailability(
  rows: (DbAvailabilityDay | DbVetAvailabilityDay)[]
): AvailabilityDay[] {
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
    // The column is still called bookingId; `kind` says what it points at.
    subjectId: r.bookingId,
    kind: r.kind as ReviewKind,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
  };
}

/* ── Vet care ─────────────────────────────────────────────────────────── */

type DbVetWithRelations = DbVet & { availability: DbVetAvailabilityDay[] };

export function toVetProfile(v: DbVetWithRelations): VetProfile {
  return {
    id: v.id,
    userId: v.userId,
    clinicName: v.clinicName,
    bio: v.bio,
    specialties: v.specialties as VetSpecialty[],
    licenseNumber: v.licenseNumber,
    licenseState: v.licenseState,
    verificationStatus: v.verificationStatus as BackgroundCheckStatus,
    yearsExperience: v.yearsExperience,
    acceptedSpecies: v.acceptedSpecies as Species[],
    consultModes: v.consultModes as ConsultMode[],
    consultFee: v.consultFee,
    emergencyAvailable: v.emergencyAvailable,
    clinic: {
      name: v.clinicName,
      city: v.clinicCity,
      state: v.clinicState,
      lat: v.lat,
      lng: v.lng,
    },
    rating: v.rating,
    reviewCount: v.reviewCount,
    responseRatePct: v.responseRatePct,
    availability: toAvailability(v.availability),
  };
}

export function toVetWithUser(
  v: DbVetWithRelations & { user: DbUser },
  origin?: { lat: number; lng: number }
): VetWithUser {
  const profile = toVetProfile(v);
  return {
    ...profile,
    user: toUser(v.user),
    // Distance is to the clinic, not the vet's home address — that's the
    // address an owner actually has to drive to.
    distanceMiles: origin ? distanceMiles(origin, profile.clinic) : undefined,
  };
}

export function toAppointment(a: DbVetAppointment): VetAppointment {
  return {
    id: a.id,
    ownerId: a.ownerId,
    vetId: a.vetId,
    petId: a.petId,
    mode: a.mode as ConsultMode,
    reason: a.reason,
    symptoms: a.symptoms,
    startDateTime: a.startDateTime,
    endDateTime: a.endDateTime,
    status: a.status as AppointmentStatus,
    fee: a.fee,
    notes: a.notes,
    createdAt: a.createdAt,
  };
}

export function toMedicalRecord(r: DbMedicalRecord): MedicalRecord {
  return {
    id: r.id,
    petId: r.petId,
    appointmentId: r.appointmentId,
    vetId: r.vetId,
    authorUserId: r.authorUserId,
    type: r.type as MedicalRecordType,
    title: r.title,
    details: r.details,
    occurredAt: r.occurredAt,
    nextDueAt: r.nextDueAt,
    medicationName: r.medicationName,
    dosage: r.dosage,
    refillsLeft: r.refillsLeft,
    expiresAt: r.expiresAt,
    productSlugs: r.productSlugs,
    createdAt: r.createdAt,
  };
}

/* ── Store ────────────────────────────────────────────────────────────── */

export function toProduct(p: DbProduct): Product {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    description: p.description,
    category: p.category as ProductCategory,
    species: p.species as Species[],
    lifeStage: p.lifeStage as LifeStage[],
    sizeLabel: p.sizeLabel,
    weightLbs: p.weightLbs,
    priceCents: p.priceCents,
    compareAtPriceCents: p.compareAtPriceCents,
    imageUrl: p.imageUrl,
    ingredients: p.ingredients,
    allergens: p.allergens,
    requiresPrescription: p.requiresPrescription,
    stockQty: p.stockQty,
    active: p.active,
    rating: p.rating,
    reviewCount: p.reviewCount,
    createdAt: p.createdAt,
  };
}

function toOrderItem(i: DbOrderItem): OrderItem {
  return {
    id: i.id,
    orderId: i.orderId,
    productId: i.productId,
    name: i.name,
    brand: i.brand,
    imageUrl: i.imageUrl,
    slug: i.slug,
    unitPriceCents: i.unitPriceCents,
    quantity: i.quantity,
    lineTotalCents: i.lineTotalCents,
  };
}

function toOrderEvent(e: DbOrderEvent): OrderEvent {
  return {
    id: e.id,
    orderId: e.orderId,
    status: e.status as OrderStatus,
    label: e.label,
    description: e.description,
    location: e.location,
    occurredAt: e.occurredAt,
  };
}

type DbOrderWithRelations = DbOrder & {
  items: DbOrderItem[];
  events: DbOrderEvent[];
};

export function toOrder(o: DbOrderWithRelations): Order {
  return {
    id: o.id,
    userId: o.userId,
    status: o.status as OrderStatus,
    paymentStatus: o.paymentStatus as PaymentStatus,
    paymentRef: o.paymentRef,
    subtotalCents: o.subtotalCents,
    shippingCents: o.shippingCents,
    taxCents: o.taxCents,
    totalCents: o.totalCents,
    shippingAddress: {
      name: o.shipName,
      line1: o.shipLine1,
      line2: o.shipLine2,
      city: o.shipCity,
      state: o.shipState,
      postalCode: o.shipPostalCode,
      country: o.shipCountry,
      phone: o.shipPhone,
    },
    deliveryInstructions: o.deliveryInstructions,
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
    placedAt: o.placedAt,
    estimatedDeliveryAt: o.estimatedDeliveryAt,
    deliveredAt: o.deliveredAt,
    items: o.items.map(toOrderItem),
    // Chronological — the timeline reads top-down from order to doorstep.
    events: o.events
      .map(toOrderEvent)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
  };
}

export function toMessage(m: DbMessage): Message {
  return {
    id: m.id,
    bookingId: m.bookingId,
    fromUserId: m.fromUserId,
    body: m.body,
    createdAt: m.createdAt,
    readAt: m.readAt,
  };
}
