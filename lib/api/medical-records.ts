/**
 * Pet health records — API client. See /lib/api/bookings.ts for the pattern.
 */

import type { MedicalRecord } from "@/types";
import { deleteJson, getJson, postJson } from "./_client";

/** What a caller supplies; the server stamps petId, author and vet. */
export type MedicalRecordInput = Pick<
  MedicalRecord,
  "type" | "title" | "occurredAt"
> &
  Partial<
    Pick<
      MedicalRecord,
      | "details"
      | "appointmentId"
      | "nextDueAt"
      | "medicationName"
      | "dosage"
      | "refillsLeft"
      | "expiresAt"
      | "productSlugs"
    >
  >;

/** GET /api/pets/:petId/medical-records -> MedicalRecord[] (newest first) */
export async function getRecordsForPet(petId: string): Promise<MedicalRecord[]> {
  return getJson<MedicalRecord[]>(`/api/pets/${petId}/medical-records`);
}

/** POST /api/pets/:petId/medical-records -> MedicalRecord (201) */
export async function createRecord(
  petId: string,
  input: MedicalRecordInput
): Promise<MedicalRecord> {
  return postJson<MedicalRecord>(`/api/pets/${petId}/medical-records`, input);
}

/** DELETE /api/medical-records/:id -> void */
export async function deleteRecord(id: string): Promise<void> {
  return deleteJson(`/api/medical-records/${id}`);
}
