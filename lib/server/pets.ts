/**
 * Pets domain — server logic.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toPet } from "./serialize";
import { genId, nowIso } from "./ids";
import type { PetInputBody, PetPatchBody } from "@/lib/validation/schemas";

export async function getPetsByOwner(ownerId: string, db: PrismaClient = defaultPrisma) {
  const rows = await db.pet.findMany({ where: { ownerId } });
  return rows.map(toPet);
}

export async function getPetById(id: string, db: PrismaClient = defaultPrisma) {
  const p = await db.pet.findUnique({ where: { id } });
  return p ? toPet(p) : null;
}

export async function getPetsByIds(ids: string[], db: PrismaClient = defaultPrisma) {
  if (ids.length === 0) return [];
  const rows = await db.pet.findMany({ where: { id: { in: ids } } });
  return rows.map(toPet);
}

export async function createPet(
  ownerId: string,
  input: PetInputBody,
  db: PrismaClient = defaultPrisma
) {
  const { vetContact, ...rest } = input;
  const p = await db.pet.create({
    data: {
      ...rest,
      id: genId("p"),
      ownerId,
      // This owner has had the animal since now, which is the honest answer for
      // a pet somebody is entering themselves.
      ownedSince: nowIso(),
      vetName: vetContact.name,
      vetPhone: vetContact.phone,
    },
  });
  return toPet(p);
}

/** Returns null when the pet doesn't exist (handler maps to 404). */
export async function updatePet(
  id: string,
  patch: PetPatchBody,
  db: PrismaClient = defaultPrisma
) {
  const existing = await db.pet.findUnique({ where: { id } });
  if (!existing) return null;

  // No `ownerId`, and none accepted by the schema either. Ownership moves in
  // exactly one place — completing an adoption, in
  // lib/server/adoptions/transfer.ts, which moves `ownedSince` with it so the
  // previous owner's caretakers and vets lose access in the same write.
  const { vetContact, ...rest } = patch;
  const p = await db.pet.update({
    where: { id },
    data: {
      ...rest,
      ...(vetContact
        ? { vetName: vetContact.name, vetPhone: vetContact.phone }
        : {}),
    },
  });
  return toPet(p);
}
