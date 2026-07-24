/**
 * Pets domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Pet } from "@/types";
import { db, delay, nextId } from "./_db";

export type PetInput = Omit<Pet, "id">;

/**
 * GET /api/owners/:ownerId/pets
 * 200 -> Pet[]
 * Used on: /dashboard (owner view), /booking/new (pet selection)
 */
export async function getPetsByOwner(ownerId: string): Promise<Pet[]> {
  return delay(db.pets.filter((p) => p.ownerId === ownerId));
}

/**
 * GET /api/pets/:id
 * 200 -> Pet
 * 404 -> null
 * Used on: /dashboard/pets/[id], booking detail (attached pets)
 */
export async function getPetById(id: string): Promise<Pet | null> {
  return delay(db.pets.find((p) => p.id === id) ?? null);
}

/**
 * GET /api/pets?ids=a,b,c
 * 200 -> Pet[]
 * Used on: /booking/[id], caretaker's incoming-request view (attached pets)
 */
export async function getPetsByIds(ids: string[]): Promise<Pet[]> {
  const set = new Set(ids);
  return delay(db.pets.filter((p) => set.has(p.id)));
}

/**
 * POST /api/owners/:ownerId/pets
 * Body: PetInput
 * 201 -> Pet
 * Used on: /dashboard/pets/new
 */
export async function createPet(input: PetInput): Promise<Pet> {
  const pet: Pet = { ...input, id: nextId("p") };
  db.pets.push(pet);
  return delay(pet);
}

/**
 * PATCH /api/pets/:id
 * Body: Partial<PetInput>
 * 200 -> Pet
 * Used on: /dashboard/pets/[id]
 */
export async function updatePet(
  id: string,
  patch: Partial<PetInput>
): Promise<Pet> {
  const pet = db.pets.find((p) => p.id === id);
  if (!pet) throw new Error(`Pet ${id} not found`);
  Object.assign(pet, patch);
  return delay({ ...pet });
}
