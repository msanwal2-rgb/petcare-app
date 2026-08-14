import type {
  AppointmentStatus,
  ConsultMode,
  LifeStage,
  MedicalRecordType,
  OrderStatus,
  Pet,
  ProductCategory,
  ServiceType,
  BookingStatus,
  UserRole,
  VetSpecialty,
} from "@/types";

/** Tiny className joiner — one dependency fewer than clsx, same ergonomics. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

const CENTS_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Format store money. The store stores integer cents everywhere; this is the
 * only place that divides by 100, so a stray `/ 100` at a call site is a bug.
 */
export function formatCents(cents: number): string {
  return CENTS_FMT.format(cents / 100);
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}
export function formatDateTime(iso: string): string {
  return DATETIME_FMT.format(new Date(iso));
}
export function formatTime(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

/** Human date range, collapsing same-day ranges to one date. */
export function formatRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${DATETIME_FMT.format(s)} – ${TIME_FMT.format(e)}`;
  }
  return `${DATETIME_FMT.format(s)} – ${DATETIME_FMT.format(e)}`;
}

export function petAge(pet: Pet, now = new Date()): string {
  const dob = new Date(pet.dob);
  const months =
    (now.getFullYear() - dob.getFullYear()) * 12 + (now.getMonth() - dob.getMonth());
  if (months < 12) return `${Math.max(months, 1)} mo`;
  const years = Math.floor(months / 12);
  return `${years} yr${years > 1 ? "s" : ""}`;
}

/** Straight-line distance in miles between two lat/lng points (haversine). */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

export const SERVICE_LABELS: Record<ServiceType, string> = {
  walking: "Walking",
  sitting: "Sitting",
  boarding: "Boarding",
  daycare: "Daycare",
};

export const SERVICE_VERBS: Record<ServiceType, string> = {
  walking: "walk",
  sitting: "sit",
  boarding: "board",
  daycare: "daycare",
};

export const STATUS_LABELS: Record<BookingStatus, string> = {
  requested: "Requested",
  accepted: "Accepted",
  declined: "Declined",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const SPECIES_LABELS: Record<Pet["species"], string> = {
  dog: "Dog",
  cat: "Cat",
  other: "Other",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Owner",
  caretaker: "Caretaker",
  vet: "Vet",
};

/* ── Vet care labels ─────────────────────────────────────────────────── */

export const SPECIALTY_LABELS: Record<VetSpecialty, string> = {
  general: "General practice",
  dermatology: "Dermatology",
  dentistry: "Dentistry",
  surgery: "Surgery",
  emergency: "Emergency",
  nutrition: "Nutrition",
  behavior: "Behaviour",
  exotics: "Exotics",
};

export const CONSULT_MODE_LABELS: Record<ConsultMode, string> = {
  in_clinic: "In clinic",
  video: "Video call",
  home_visit: "Home visit",
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  requested: "Requested",
  confirmed: "Confirmed",
  declined: "Declined",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const RECORD_TYPE_LABELS: Record<MedicalRecordType, string> = {
  visit_note: "Visit note",
  vaccination: "Vaccination",
  prescription: "Prescription",
  lab_result: "Lab result",
  weight: "Weight",
  allergy: "Allergy",
};

/* ── Store labels ────────────────────────────────────────────────────── */

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  dry_food: "Dry food",
  wet_food: "Wet food",
  treats: "Treats",
  supplements: "Supplements",
  prescription_diet: "Prescription diet",
  dental: "Dental",
  accessories: "Accessories",
};

export const LIFE_STAGE_LABELS: Record<LifeStage, string> = {
  puppy: "Puppy",
  kitten: "Kitten",
  adult: "Adult",
  senior: "Senior",
  all: "All ages",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Payment confirmed",
  processing: "Preparing your order",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Duration between two ISO datetimes, expressed in whole hours and days. */
export function durationHours(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(1, Math.round(ms / 3_600_000));
}
export function durationDays(startIso: string, endIso: string): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(1, Math.ceil(ms / 86_400_000));
}
