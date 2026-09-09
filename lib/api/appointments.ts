/**
 * Vet appointments — API client. See /lib/api/bookings.ts for the pattern.
 */

import type {
  AppointmentStatus,
  CreateAppointmentInput,
  VetAppointment,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson } from "./_client";

/** GET /api/owners/:ownerId/appointments -> VetAppointment[] (newest first) */
export async function getAppointmentsByOwner(
  ownerId: string
): Promise<VetAppointment[]> {
  return getJson<VetAppointment[]>(`/api/owners/${ownerId}/appointments`);
}

/** GET /api/vets/:vetId/appointments -> VetAppointment[] (newest first) */
export async function getAppointmentsByVet(
  vetId: string
): Promise<VetAppointment[]> {
  return getJson<VetAppointment[]>(`/api/vets/${vetId}/appointments`);
}

/** GET /api/appointments/:id -> VetAppointment | null(404) */
export async function getAppointmentById(
  id: string
): Promise<VetAppointment | null> {
  return getJsonOrNull<VetAppointment>(`/api/appointments/${id}`);
}

/**
 * POST /api/appointments -> VetAppointment (201, status=requested).
 * `fee` is omitted deliberately — the server reads it off the vet's profile.
 */
export async function createAppointment(
  input: Omit<CreateAppointmentInput, "fee">
): Promise<VetAppointment> {
  // No owner id: the server books it as whoever is signed in.
  return postJson<VetAppointment>(`/api/appointments`, input);
}

/** PATCH /api/appointments/:id/status -> VetAppointment */
export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus
): Promise<VetAppointment> {
  return patchJson<VetAppointment>(`/api/appointments/${id}/status`, { status });
}
