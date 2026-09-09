/**
 * Pets domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Pet } from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson, qs } from "./_client";

/**
 * No `ownerId`: it is a path parameter on create and unchangeable thereafter.
 * Ownership moves only by completing an adoption.
 */
export type PetInput = Omit<Pet, "id" | "ownerId">;

/** GET /api/owners/:ownerId/pets -> Pet[] */
export async function getPetsByOwner(ownerId: string): Promise<Pet[]> {
  return getJson<Pet[]>(`/api/owners/${ownerId}/pets`);
}

/** GET /api/pets/:id -> Pet | null(404) */
export async function getPetById(id: string): Promise<Pet | null> {
  return getJsonOrNull<Pet>(`/api/pets/${id}`);
}

/** GET /api/pets?ids=a,b,c -> Pet[] */
export async function getPetsByIds(ids: string[]): Promise<Pet[]> {
  if (ids.length === 0) return [];
  return getJson<Pet[]>(`/api/pets${qs({ ids: ids.join(",") })}`);
}

/** POST /api/owners/:ownerId/pets -> Pet (201) */
export async function createPet(ownerId: string, input: PetInput): Promise<Pet> {
  return postJson<Pet>(`/api/owners/${ownerId}/pets`, input);
}

/** PATCH /api/pets/:id -> Pet */
export async function updatePet(
  id: string,
  patch: Partial<PetInput>
): Promise<Pet> {
  return patchJson<Pet>(`/api/pets/${id}`, patch);
}
