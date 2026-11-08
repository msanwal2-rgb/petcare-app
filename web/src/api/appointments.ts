import type {
  AppointmentStatus,
  ConsultMode,
  MedicalRecord,
  MedicalRecordType,
  Review,
  VetAppointment,
} from "@/types";
import { getJson, postJson, patchJson, qs } from "./_client";

/**
 * Vet appointments, their visit summaries and their reviews — API client.
 *
 * ── There is no fee here, and no owner ──
 *
 * `CreateAppointmentInput` carries neither. The server reads the clinic's own
 * `consultFee`, applies whatever membership discount the caller holds, and
 * records all three numbers. The figure a booking form shows is an estimate for
 * the customer; if it ever disagrees with what comes back, the profile is right.
 */

export interface AppointmentPage {
  items: VetAppointment[];
  nextCursor: string | null;
}

export interface CreateAppointmentInput {
  vetId: string;
  petId: string;
  mode: ConsultMode;
  reason: string;
  symptoms?: string[];
  startDateTime: string;
  endDateTime: string;
  notes?: string;
}

/**
 * A list read. Without `from` it is newest first. With `from` it is a window
 * of the calendar, soonest first: everything not over before `from` and, given
 * `to`, starting before it. `status` (comma-separated) filters a window.
 */
export interface AppointmentListParams {
  cursor?: string;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
}

/** GET /appointments -> the caller's own appointments, by visit date. */
export function listMyAppointments(
  params: AppointmentListParams = {},
): Promise<AppointmentPage> {
  return getJson<AppointmentPage>(`/appointments${qs({ ...params })}`);
}

/** GET /vets/:id/appointments -> that clinic's schedule. Theirs alone. */
export function listVetAppointments(
  vetId: string,
  params: AppointmentListParams = {},
): Promise<AppointmentPage> {
  return getJson<AppointmentPage>(`/vets/${vetId}/appointments${qs({ ...params })}`);
}

/**
 * POST /appointments/:id/reschedule -> the appointment at its new time.
 *
 * The vet only (403 for the owner), and only while it is requested or
 * confirmed (409 otherwise). The status does not change; the owner is told in
 * the app and by email.
 */
export function rescheduleAppointment(
  id: string,
  window: { startDateTime: string; endDateTime: string },
): Promise<VetAppointment> {
  return postJson<VetAppointment>(`/appointments/${id}/reschedule`, window);
}

/** GET /appointments/:id -> either party only; 404 to anyone else. */
export function getAppointment(id: string): Promise<VetAppointment> {
  return getJson<VetAppointment>(`/appointments/${id}`);
}

/** POST /appointments -> VetAppointment (201). */
export function createAppointment(
  input: CreateAppointmentInput,
): Promise<VetAppointment> {
  return postJson<VetAppointment>("/appointments", input);
}

/**
 * PATCH /appointments/:id/status.
 *
 * Throws `ApiError` 409 when the move is not legal from where the appointment
 * is, and 403 when it is legal but the caller is the wrong party — an owner
 * cannot confirm their own appointment. The two are different failures on
 * purpose.
 *
 * Note the vocabulary: `confirmed`, not `accepted`. Appointments run on
 * REQUIREMENTS.md §11.2 and bookings on §11.1.
 */
export function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
): Promise<VetAppointment> {
  return patchJson<VetAppointment>(`/appointments/${id}/status`, { status });
}

/* ── The visit summary ───────────────────────────────────────────────── */

/**
 * One entry in a visit summary.
 *
 * No `vetId` and no `authorUserId`: the server stamps both from the vet profile
 * that granted clinical access. No `petId` and no `appointmentId` either —
 * both come from the appointment this summary is being written against, which
 * is what makes it impossible to file a finding under another animal's visit
 * (REQUIREMENTS.md V8).
 *
 * `occurredAt` may be omitted, and then means when the visit ended.
 */
export interface VisitSummaryEntry {
  type: MedicalRecordType;
  title: string;
  details?: string;
  occurredAt?: string;
  nextDueAt?: string | null;
  medicationName?: string | null;
  dosage?: string | null;
  refillsLeft?: number | null;
  expiresAt?: string | null;
  productSlugs?: string[];
}

export interface VisitSummaryResult {
  appointment: VetAppointment;
  records: MedicalRecord[];
}

/**
 * POST /appointments/:id/visit-summary -> the completed visit and its records.
 *
 * The treating vet only, and only while the visit is `in_progress`. This is
 * the write that turns a consultation into a permanent clinical record — a
 * prescription written here is what unlocks an Rx-only product in the store.
 */
export function completeVisit(
  appointmentId: string,
  records: VisitSummaryEntry[],
): Promise<VisitSummaryResult> {
  return postJson<VisitSummaryResult>(`/appointments/${appointmentId}/visit-summary`, {
    records,
  });
}

/* ── Reviews ─────────────────────────────────────────────────────────── */

/** GET /appointments/:id/reviews -> the one review, if it exists. */
export function getAppointmentReviews(appointmentId: string): Promise<Review[]> {
  return getJson<Review[]>(`/appointments/${appointmentId}/reviews`);
}

/**
 * POST /appointments/:id/reviews -> Review (201).
 *
 * **One direction only.** The owner reviews the vet; there is no reverse, and
 * a vet who tries gets a 403 rather than a missing feature. A clinician rating
 * the client is a different and much worse product.
 */
export function createAppointmentReview(
  appointmentId: string,
  input: { toUserId: string; rating: number; comment?: string },
): Promise<Review> {
  return postJson<Review>(`/appointments/${appointmentId}/reviews`, input);
}
