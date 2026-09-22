import type {
  MedicalRecord,
  MedicalRecordType,
  Pet,
  Product,
  VetAppointment,
} from "@/types";
import {
  deleteJson,
  getJson,
  getJsonOrNull,
  patchJson,
  postJson,
  qs,
} from "./_client";

/**
 * Pets and health records — API client. Pages import ONLY from here.
 *
 * ── What is not in these types ──
 *
 * `Pet` has no `ownedSince` and no way to set `ownerId`. Both are deliberate.
 * `ownedSince` is an authorization input the server reads and never sends, and
 * ownership moves in exactly one place — completing an adoption (M10) — not
 * through an edit form. The reference project's `PetForm` spread `ownerId` into
 * every patch payload, which is how a stale prop could hand somebody's animal
 * to another account by accident.
 */

/** A pet as the create/edit forms submit it: `Pet` without the server's fields. */
export type PetInput = Omit<Pet, "id" | "ownerId">;

/** GET /pets -> the caller's own pets. */
export function listMyPets(): Promise<Pet[]> {
  return getJson<Pet[]>("/pets");
}

/**
 * GET /pets?ids=a,b,c -> the ones you may see.
 *
 * Filtered rather than refused: a booking detail page asks for every pet on the
 * booking and a caretaker is entitled to all of them, so an id you may not see
 * is simply absent from the answer.
 */
export function getPetsByIds(ids: string[]): Promise<Pet[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return getJson<Pet[]>(`/pets${qs({ ids: ids.join(",") })}`);
}

/** GET /pets/:id -> Pet | null(404). Owner, sitter with a booking, or treating vet. */
export function getPetById(id: string): Promise<Pet | null> {
  return getJsonOrNull<Pet>(`/pets/${id}`);
}

/** POST /pets -> Pet (201). The owner is the caller; the body cannot name one. */
export function createPet(input: PetInput): Promise<Pet> {
  return postJson<Pet>("/pets", input);
}

/** PATCH /pets/:id -> Pet. Owner only. */
export function updatePet(id: string, patch: Partial<PetInput>): Promise<Pet> {
  return patchJson<Pet>(`/pets/${id}`, patch);
}

/**
 * DELETE /pets/:id -> 204.
 *
 * Throws `ApiError` with status 409 when the animal has vet visits or health
 * records — deleting it would cascade away records its vets wrote, which an
 * owner may not do one at a time either.
 */
export function deletePet(id: string): Promise<void> {
  return deleteJson(`/pets/${id}`);
}

/**
 * GET /pets/:id/appointments -> the animal's visit history.
 *
 * Scoped by the pet, not by who booked each visit, so a treating vet sees the
 * whole history. Visits you did not book arrive with no `fee` property at all —
 * hence `Partial<Pick<…>>` rather than a nullable field.
 */
export function getPetAppointments(
  id: string,
): Promise<(Omit<VetAppointment, "fee"> & Partial<Pick<VetAppointment, "fee">>)[]> {
  return getJson(`/pets/${id}/appointments`);
}

/** GET /pets/:id/recommendations -> Product[]. Owner only. */
export function getPetRecommendations(id: string): Promise<Product[]> {
  return getJson<Product[]>(`/pets/${id}/recommendations`);
}

/* ── Health records ──────────────────────────────────────────────────── */

/** GET /pets/:id/medical-records -> the timeline. Owner or treating vet; 403 otherwise. */
export function getPetRecords(id: string): Promise<MedicalRecord[]> {
  return getJson<MedicalRecord[]>(`/pets/${id}/medical-records`);
}

/**
 * A new health record. No author and no vet id: the server stamps both from the
 * authenticated caller and from the access check that granted the write.
 */
export type MedicalRecordInput = {
  type: MedicalRecordType;
  title: string;
  details?: string;
  occurredAt: string;
  appointmentId?: string | null;
  nextDueAt?: string | null;
  medicationName?: string | null;
  dosage?: string | null;
  refillsLeft?: number | null;
  expiresAt?: string | null;
  productSlugs?: string[];
};

/**
 * POST /pets/:id/medical-records -> MedicalRecord (201).
 *
 * A treating vet may write any type. An owner may write only `allergy` and
 * `weight` — anything else is a 403, because a prescription written by the
 * patient's owner would defeat the store's Rx gate.
 */
export function createPetRecord(
  petId: string,
  input: MedicalRecordInput,
): Promise<MedicalRecord> {
  return postJson<MedicalRecord>(`/pets/${petId}/medical-records`, input);
}

/** DELETE /medical-records/:id -> 204. Author only. */
export function deleteMedicalRecord(id: string): Promise<void> {
  return deleteJson(`/medical-records/${id}`);
}
