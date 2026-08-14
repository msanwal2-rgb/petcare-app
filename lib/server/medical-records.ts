/**
 * Pet health records — server logic.
 *
 * A record is the durable output of veterinary care, and the store reads it:
 * an unexpired `prescription` record is what authorises an Rx-only product.
 * That makes authorship matter, so it's constrained here rather than in the UI:
 * only a treating vet may write clinical entry types; an owner may add the
 * self-reported kinds (allergy, weight) to their own pet.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toMedicalRecord } from "./serialize";
import { genId, nowIso } from "./ids";
import type { MedicalRecordType } from "@/types";
import type { MedicalRecordBody } from "@/lib/validation/schemas";

/** Entry types an owner may author on their own pet. */
const OWNER_AUTHORABLE: MedicalRecordType[] = ["allergy", "weight"];

export function ownerMayAuthor(type: MedicalRecordType): boolean {
  return OWNER_AUTHORABLE.includes(type);
}

export async function getRecordsForPet(
  petId: string,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.medicalRecord.findMany({
    where: { petId },
    orderBy: { occurredAt: "desc" },
  });
  return rows.map(toMedicalRecord);
}

export async function getRecordById(
  id: string,
  db: PrismaClient = defaultPrisma
) {
  const r = await db.medicalRecord.findUnique({ where: { id } });
  return r ? toMedicalRecord(r) : null;
}

export async function createRecord(
  petId: string,
  authorUserId: string,
  asVetId: string | null,
  input: MedicalRecordBody,
  db: PrismaClient = defaultPrisma
) {
  const r = await db.medicalRecord.create({
    data: {
      ...input,
      id: genId("mr"),
      petId,
      authorUserId,
      vetId: asVetId,
      createdAt: nowIso(),
    },
  });
  return toMedicalRecord(r);
}

export async function deleteRecord(id: string, db: PrismaClient = defaultPrisma) {
  await db.medicalRecord.delete({ where: { id } });
}

/**
 * Prescriptions for a pet that are still valid at `now` — the exact set the
 * store checks before letting an Rx-only product into an order.
 *
 * A missing `expiresAt` means the vet set no end date, which counts as valid;
 * `refillsLeft === 0` does not, since the authorisation is used up.
 */
export async function activePrescriptions(
  petId: string,
  now: string = nowIso(),
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.medicalRecord.findMany({
    where: {
      petId,
      type: "prescription",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      NOT: { refillsLeft: 0 },
    },
    orderBy: { occurredAt: "desc" },
  });
  return rows.map(toMedicalRecord);
}

/**
 * Which of `slugs` this pet is currently authorised for. Used by the checkout
 * guard and by the product page's "you have a prescription for this" state.
 */
export async function authorizedProductSlugs(
  petId: string,
  now?: string,
  db: PrismaClient = defaultPrisma
): Promise<Set<string>> {
  const active = await activePrescriptions(petId, now, db);
  return new Set(active.flatMap((r) => r.productSlugs));
}
