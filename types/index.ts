/**
 * Domain models for the Pet Care Marketplace (brief §4).
 * These mirror exactly what the backend will return, so the same
 * types are used by the mock data layer today and the real API later.
 */

export type UserRole = "owner" | "caretaker" | "vet";

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

/** What was reviewed. Bookings are reviewed both ways; vet visits are not. */
export type ReviewKind = "booking" | "vet_appointment";

export interface Review {
  id: string;
  /** The Booking or VetAppointment being reviewed — see `kind`. */
  subjectId: string;
  kind: ReviewKind;
  fromUserId: string;
  toUserId: string;
  rating: number; // 0–5
  comment: string;
  createdAt: string; // ISO 8601
}

export interface Message {
  id: string;
  bookingId: string;
  fromUserId: string;
  body: string;
  createdAt: string; // ISO 8601
  readAt: string | null;
}

/* ── Vet care ───────────────────────────────────────────────────
   Vets are the third side of the marketplace: an owner books an
   appointment much like a caretaker booking, and the outcome is written
   into the pet's health record — which in turn gates the store. */

export type VetSpecialty =
  | "general"
  | "dermatology"
  | "dentistry"
  | "surgery"
  | "emergency"
  | "nutrition"
  | "behavior"
  | "exotics";

/** Where the consultation happens. */
export type ConsultMode = "in_clinic" | "video" | "home_visit";

export interface VetProfile {
  id: string;
  userId: string;
  clinicName: string;
  bio: string;
  specialties: VetSpecialty[];
  licenseNumber: string;
  licenseState: string;
  yearsExperience: number;
  acceptedSpecies: Species[];
  consultModes: ConsultMode[];
  consultFee: number; // USD, per appointment
  emergencyAvailable: boolean;
  clinic: { name: string; city: string; state: string; lat: number; lng: number };
  rating: number; // 0–5
  reviewCount: number;
  responseRatePct: number; // 0–100
  availability: AvailabilityDay[];
}

/** A vet joined with its owning User — what search results and profiles render. */
export interface VetWithUser extends VetProfile {
  user: User;
  distanceMiles?: number;
}

export type AppointmentStatus =
  | "requested"
  | "confirmed"
  | "declined"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface VetAppointment {
  id: string;
  ownerId: string;
  vetId: string; // VetProfile.id
  petId: string;
  mode: ConsultMode;
  reason: string;
  symptoms: string[];
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  status: AppointmentStatus;
  fee: number; // USD
  notes: string;
  createdAt: string; // ISO 8601
}

export type MedicalRecordType =
  | "visit_note"
  | "vaccination"
  | "prescription"
  | "lab_result"
  | "weight"
  | "allergy";

/**
 * One entry in a pet's health timeline. Prescription entries carry the extra
 * medication fields and are what unlock Rx-only products in the store.
 */
export interface MedicalRecord {
  id: string;
  petId: string;
  appointmentId: string | null;
  vetId: string | null; // VetProfile.id, when authored by a vet
  authorUserId: string;
  type: MedicalRecordType;
  title: string;
  details: string;
  occurredAt: string; // ISO 8601
  nextDueAt: string | null; // e.g. next vaccination booster
  medicationName: string | null;
  dosage: string | null;
  refillsLeft: number | null;
  expiresAt: string | null; // prescription validity
  productSlugs: string[]; // store products the vet recommended
  createdAt: string; // ISO 8601
}

export interface CreateAppointmentInput {
  ownerId: string;
  vetId: string;
  petId: string;
  mode: ConsultMode;
  reason: string;
  symptoms: string[];
  startDateTime: string;
  endDateTime: string;
  notes: string;
  fee: number;
}

export interface VetSearchParams {
  location?: string;
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  specialty?: VetSpecialty;
  species?: Species;
  mode?: ConsultMode;
  emergencyOnly?: boolean;
}

/* ── Store ──────────────────────────────────────────────────────
   Money in the store is stored and transmitted as integer cents. Floats
   drift under arithmetic; an order total must not. Format with
   formatCents() — never divide by 100 at a call site. */

export type ProductCategory =
  | "dry_food"
  | "wet_food"
  | "treats"
  | "supplements"
  | "prescription_diet"
  | "dental"
  | "accessories";

export type LifeStage = "puppy" | "kitten" | "adult" | "senior" | "all";

export interface Product {
  id: string;
  slug: string;
  name: string;
  brand: string;
  description: string;
  category: ProductCategory;
  species: Species[];
  lifeStage: LifeStage[];
  sizeLabel: string; // "12 lb bag", "24 × 3 oz cans"
  weightLbs: number;
  priceCents: number;
  compareAtPriceCents: number | null; // strike-through "was" price
  imageUrl: string;
  ingredients: string[];
  allergens: string[]; // matched against Pet.allergies
  requiresPrescription: boolean;
  stockQty: number;
  active: boolean;
  rating: number; // 0–5
  reviewCount: number;
  createdAt: string; // ISO 8601
}

export interface ProductSearchParams {
  q?: string;
  category?: ProductCategory;
  species?: Species;
  lifeStage?: LifeStage;
  brand?: string;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: ProductSort;
  limit?: number;
  offset?: number;
}

export type ProductSort = "featured" | "price_asc" | "price_desc" | "rating" | "newest";

export interface ProductPage {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Order lifecycle. The happy path runs top to bottom; `cancelled` and
 * `refunded` are terminal branches. Enforced server-side in lib/server/orders.ts.
 */
export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "processing"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentStatus = "unpaid" | "authorized" | "paid" | "refunded" | "failed";

export interface ShippingAddress {
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  /** Snapshotted at purchase — a later price or name change must not rewrite history. */
  name: string;
  brand: string;
  imageUrl: string;
  slug: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

/** One step in the order's journey from the store to the recipient's home. */
export interface OrderEvent {
  id: string;
  orderId: string;
  status: OrderStatus;
  label: string;
  description: string;
  location: string | null;
  occurredAt: string; // ISO 8601
}

export interface Order {
  id: string;
  userId: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentRef: string | null;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  shippingAddress: ShippingAddress;
  deliveryInstructions: string;
  carrier: string | null;
  trackingNumber: string | null;
  placedAt: string; // ISO 8601
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  items: OrderItem[];
  events: OrderEvent[];
}

export interface CartLineInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderInput {
  items: CartLineInput[];
  shippingAddress: ShippingAddress;
  deliveryInstructions?: string;
  /** Pet this order is for — enables the Rx check on prescription-only items. */
  petId?: string;
}

/**
 * Server-side re-pricing result. The client's cart totals are display-only;
 * this is the authority, and it reports back anything that changed.
 */
export interface CartQuote {
  lines: {
    productId: string;
    slug: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    lineTotalCents: number;
    inStock: boolean;
    requiresPrescription: boolean;
  }[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** Non-empty when the client's assumptions no longer hold. */
  problems: { productId: string; code: CartProblemCode; message: string }[];
}

export type CartProblemCode =
  | "not_found"
  | "inactive"
  | "out_of_stock"
  | "insufficient_stock"
  | "prescription_required";

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
