/**
 * Domain models for the Pet Care Marketplace (brief §4).
 * These mirror exactly what the backend will return, so the same
 * types are used by the mock data layer today and the real API later.
 */

export type UserRole = "owner" | "caretaker" | "vet" | "shelter";

/**
 * Staff privileges. Orthogonal to `UserRole` — those say what someone does in
 * the marketplace, these say what they may do to it. "admin" satisfies every
 * check.
 */
export type StaffRole = "ops" | "support" | "finance" | "admin";

export type AccountStatus = "active" | "suspended" | "deleted";

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
  /**
   * The caller's own staff privileges. Safe to send to the client because it
   * only ever describes the user it is sent to — it is what lets the header
   * decide whether to show an "Admin" link, and nothing is authorised by it.
   */
  staffRoles: StaffRole[];
  status: AccountStatus;
}

/**
 * A user as anyone may see them: enough to render a caretaker card or a review
 * byline, and nothing that would make the id space worth enumerating. Contrast
 * `User`, which carries email, phone and home coordinates.
 */
export interface PublicUser {
  id: string;
  name: string;
  avatarUrl: string;
  roles: UserRole[];
  address: { city: string; state: string };
  verified: boolean;
  createdAt: string;
}

/* ── Shelters ─────────────────────────────────────────────────── */

export type ShelterKind = "municipal" | "rescue" | "sanctuary" | "foster_network";

export interface ShelterProfile {
  id: string;
  userId: string;
  /** The shelter's public name; the account holder's is on the User. */
  name: string;
  bio: string;
  kind: ShelterKind;
  registrationNumber: string;
  registrationState: string;
  /** Checked by a human in the admin console. */
  verificationStatus: BackgroundCheckStatus;
  acceptedSpecies: Species[];
  websiteUrl: string;
  phone: string;
  email: string;
  address: { line: string; city: string; state: string; lat: number; lng: number };
  adoptionPolicy: string;
  /** Derived from application statuses. Never patchable. */
  responseRatePct: number;
  createdAt: string;
}

export interface ShelterWithUser extends ShelterProfile {
  user: PublicUser;
  distanceMiles?: number;
  /** How many animals they currently have available. */
  availableCount: number;
}

/* ── Adoption ─────────────────────────────────────────────────── */

export type ListingStatus =
  | "draft"
  | "available"
  | "pending"
  | "adopted"
  | "withdrawn";

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "approved"
  | "completed"
  | "rejected"
  | "withdrawn";

/** "unknown" is the honest answer for an animal nobody has tested yet. */
export type TriState = "yes" | "no" | "unknown";
export type EnergyLevel = "low" | "moderate" | "high";
export type HomeType = "house" | "apartment" | "condo" | "other";

export interface AdoptionListing {
  id: string;
  shelterId: string;
  petId: string;
  status: ListingStatus;
  /** Integer cents — this reaches the payment ledger, which counts in cents. */
  feeCents: number;
  currency: string;
  headline: string;
  story: string;
  goodWithKids: TriState;
  goodWithDogs: TriState;
  goodWithCats: TriState;
  houseTrained: TriState;
  energyLevel: EnergyLevel;
  specialNeeds: boolean;
  specialNeedsNotes: string;
  spayedNeutered: boolean;
  microchipped: boolean;
  /** Where the animal actually is — a fostered dog is not at the shelter. */
  location: { city: string; state: string; lat: number; lng: number };
  intakeAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

/** A listing with the animal it is about, which is what a card renders. */
export interface AdoptionListingWithPet extends AdoptionListing {
  pet: Pet;
  shelterName: string;
  distanceMiles?: number;
}

export interface AdoptionListingPage {
  items: AdoptionListingWithPet[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdoptionApplication {
  id: string;
  listingId: string;
  shelterId: string;
  petId: string;
  /** Snapshotted, so the row still means something if the listing is gone. */
  petName: string;
  petPhotoUrl: string;
  applicantId: string;
  status: ApplicationStatus;
  /** Snapshotted at submission — a later edit can't rewrite the quote. */
  feeCents: number;
  householdAdults: number;
  householdChildren: number;
  hasOtherPets: boolean;
  otherPetsNotes: string;
  homeType: HomeType;
  fencedYard: boolean;
  ownsHome: boolean;
  hoursAlonePerDay: number;
  experience: string;
  message: string;
  decisionNote: string;
  decidedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** An application as the shelter reviewing it sees it. */
export interface AdoptionApplicationWithApplicant extends AdoptionApplication {
  applicant: PublicUser;
  /** Set once a fee has been charged; null for a waived one. */
  paymentStatus: PaymentStatus | null;
}

/* ── Membership ───────────────────────────────────────────────── */

/** What a plan grants. Enforced server-side, never a badge. */
export type Entitlement =
  | "free_shipping"
  | "vet_consult_discount"
  | "priority_booking";

/**
 * Stripe's own subscription vocabulary rather than a parallel one of our own —
 * every value arrives from a webhook, and a translation layer is somewhere for
 * the two to drift.
 */
export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled";

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: string;
  entitlements: Entitlement[];
  consultDiscountPct: number;
  active: boolean;
  /** False until the plan exists in the payment provider. */
  purchasable: boolean;
}

/** The answer to "what is this customer entitled to, right now?". */
export interface Membership {
  active: boolean;
  planKey: string | null;
  planName: string | null;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** True while a failed renewal is still being retried. */
  inGrace: boolean;
  entitlements: Entitlement[];
  consultDiscountPct: number;
}

/** What /api/membership returns: what you have, and what you could have. */
export interface MembershipView {
  membership: Membership;
  plan: Plan | null;
}

export type RefundStatus = "pending" | "succeeded" | "failed" | "canceled";

/* ── Administration ───────────────────────────────────────────── */

/** How an account can authenticate. The presence of a credential, never the credential. */
export type AuthMethod = "password" | "google";

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  roles: UserRole[];
  staffRoles: StaffRole[];
  status: AccountStatus;
  verified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  city: string;
  state: string;
  authMethods: AuthMethod[];
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  nextCursor: string | null;
  total: number;
}

export interface AdminOrderSummary {
  id: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  placedAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  phone: string;
  address: { city: string; state: string; lat: number; lng: number };
  suspendedAt: string | null;
  suspendedReason: string;
  deletedAt: string | null;
  sessionsValidFrom: string | null;
  counts: {
    pets: number;
    bookings: number;
    appointments: number;
    orders: number;
    unreadNotifications: number;
  };
  recentOrders: AdminOrderSummary[];
  caretakerProfile: {
    id: string;
    backgroundCheckStatus: string;
    rating: number;
    reviewCount: number;
  } | null;
  vetProfile: {
    id: string;
    clinicName: string;
    licenseNumber: string;
    licenseState: string;
  } | null;
}

/** The overview page. Every number here is a link to the list that explains it. */
export interface AdminStats {
  users: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
    suspended: number;
    unverified: number;
    staff: number;
  };
  bookings: { total: number; byStatus: Record<string, number> };
  appointments: { total: number; byStatus: Record<string, number> };
  orders: {
    total: number;
    grossCents: number;
    byStatus: Record<string, number>;
    awaitingFulfilment: number;
  };
  catalog: { active: number; outOfStock: number };
}

export interface AdminRefundRow {
  id: string;
  amountCents: number;
  status: RefundStatus;
  reason: string;
  initiatedBy: string;
  createdAt: string;
  settledAt: string | null;
}

export interface AdminPaymentRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  kind: string;
  orderId: string | null;
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  methodBrand: string;
  methodLast4: string;
  failureMessage: string;
  createdAt: string;
  succeededAt: string | null;
  refunds: AdminRefundRow[];
}

export interface AdminPaymentPage {
  items: AdminPaymentRow[];
  nextCursor: string | null;
  total: number;
  /** Totals over the filtered set, so they describe what is on screen. */
  capturedCents: number;
  refundedCents: number;
}

export interface AdminSubscriptionRow {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  planName: string;
  priceCents: number;
  status: SubscriptionStatus;
  providerRef: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: string | null;
  createdAt: string;
}

export interface AdminSubscriptionPage {
  items: AdminSubscriptionRow[];
  nextCursor: string | null;
  total: number;
  activeCount: number;
  /** Normalised to a month, so annual and monthly plans are comparable. */
  mrrCents: number;
}

export type VerificationStatus = BackgroundCheckStatus;

export interface AdminProfessionalRow {
  id: string;
  kind: "caretaker" | "vet" | "shelter";
  userId: string;
  userName: string;
  userEmail: string;
  avatarUrl: string;
  status: VerificationStatus;
  rating: number;
  reviewCount: number;
  /** One line of whatever is worth checking for this kind of professional. */
  detail: string;
}

export interface AdminProfessionalPage {
  items: AdminProfessionalRow[];
  nextCursor: string | null;
  total: number;
  awaitingReview: number;
}

/** Non-sensitive settings the browser may read. See /api/config. */
export interface PublicConfig {
  signupsOpen: boolean;
  maintenanceBanner: string;
  demoLoginVisible: boolean;
  /**
   * Whether the Google button should render (REQUIREMENTS.md A6).
   *
   * New in this build. The reference project asked Auth.js `getProviders()`
   * instead, which does not exist outside Next.js — and one public GET the page
   * already makes is cheaper than a second endpoint for one boolean. Nothing is
   * authorised by it: the server answers 503 if the flow is started while
   * unconfigured.
   */
  googleEnabled: boolean;
}

export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  metadata: Record<string, unknown> | null;
  ip: string;
  createdAt: string;
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
  /**
   * Whether a person has checked that licence. Public, because it is the whole
   * point: a badge nobody can grant means nothing to the owner reading it.
   */
  verificationStatus: BackgroundCheckStatus;
  yearsExperience: number;
  acceptedSpecies: Species[];
  consultModes: ConsultMode[];
  consultFee: number; // USD, per appointment
  emergencyAvailable: boolean;
  /**
   * `phone` is new in this build: the practice's public line, shown in the
   * profile's emergency panel. Empty until the vet sets it. The reference
   * printed the vet's personal `user.phone` there instead (db/changes/003).
   */
  clinic: { name: string; city: string; state: string; lat: number; lng: number; phone: string };
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

/**
 * A visit as somebody other than its booker sees it: everything clinical, no
 * money. See `toClinicalAppointment`.
 */
export type ClinicalAppointment = Omit<VetAppointment, "fee">;

export interface CreateAppointmentInput {
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
  /** Opaque — from the previous page's `nextCursor`. Encodes the sort it was minted under. */
  cursor?: string;
}

export type ProductSort = "featured" | "price_asc" | "price_desc" | "rating" | "newest";

/**
 * One page of the catalogue. Keyset-paginated like every list in this API
 * (STATUS.md §5) — the reference returned `{ total, limit, offset }`, which
 * repeats or skips rows when stock and ratings move between pages.
 */
export interface ProductPage {
  items: Product[];
  /** null at the end of the results. */
  nextCursor: string | null;
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

/**
 * Where a payment stands.
 *
 * Wider than it was, because a real card payment has states a demo provider
 * never needed: `pending` while the customer has not confirmed, `requires_action`
 * when their bank interposes a challenge, `processing` for methods that settle
 * over days, `partially_refunded` when only some of it came back, and
 * `disputed` for a chargeback.
 */
export type PaymentStatus =
  | "unpaid"
  | "pending"
  | "requires_action"
  | "processing"
  | "authorized"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "failed"
  | "disputed";

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
/**
 * What POST /api/orders answers with: the order, plus what the browser needs to
 * finish paying for it.
 *
 * `clientSecret` reaches exactly one response and is never stored — it
 * authorises confirming this one payment.
 */
export interface PlacedOrder extends Order {
  payment?: { ref: string; clientSecret: string | null; provider: string };
}

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
  /** Whether the customer pricing this cart is a member, for honest UI. */
  membership: { active: boolean; planKey: string | null };
  /** True when membership is what made shipping free, not the basket size. */
  shippingWaivedByMembership: boolean;
  /** What a non-member would have paid extra on this basket. */
  membershipSavingsCents: number;
  /**
   * Products containing something the selected pet reacts to (REQUIREMENTS.md
   * S8). Matched server-side by the one allergen matcher in the codebase — the
   * reference matched in three places, this client being one of them. A
   * warning, not a refusal: the line is still priced.
   */
  allergenWarnings: { productId: string; allergens: string[] }[];
  /** How much more for free shipping; 0 when already there, or a member (S6). */
  amountToFreeShippingCents: number;
}

/* ── Notifications ─────────────────────────────────────────────────── */

export type NotificationKind =
  | "booking_accepted"
  | "booking_declined"
  | "appointment_confirmed"
  | "appointment_declined"
  | "appointment_completed"
  | "order_shipped"
  | "order_out_for_delivery"
  | "order_delivered"
  | "order_payment_failed"
  | "membership_started"
  | "membership_payment_failed"
  | "membership_cancelled"
  | "membership_ended"
  | "adoption_application_received"
  | "adoption_under_review"
  | "adoption_approved"
  | "adoption_rejected"
  | "adoption_completed"
  | "adoption_reversed"
  /** Staff verified a caretaker, vet or shelter. The reference reused membership_started. */
  | "profile_verified";

export interface Notification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where clicking it should take you. */
  href: string;
  readAt: string | null;
  createdAt: string; // ISO 8601
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
  // No price. The server reads the caretaker's rate card and multiplies by the
  // duration; the form's running total is an estimate shown to the customer,
  // not an input.
}
