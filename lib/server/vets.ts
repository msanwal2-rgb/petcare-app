/**
 * Vets domain — server logic. Deliberately mirrors lib/server/caretakers.ts:
 * the two are the same shape of thing (a user-linked professional profile with
 * availability, a rating, and a search), so they read the same way.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toVetProfile, toVetWithUser } from "./serialize";
import type { VetPatchBody } from "@/lib/validation/schemas";
import type { VetSearchParams } from "@/types";

const withRelations = { availability: true, user: true } as const;

export async function searchVets(
  params: VetSearchParams = {},
  db: PrismaClient = defaultPrisma
) {
  const origin =
    params.lat != null && params.lng != null
      ? { lat: params.lat, lng: params.lng }
      : undefined;

  const rows = await db.vetProfile.findMany({ include: withRelations });
  let results = rows.map((v) => toVetWithUser(v, origin));

  if (params.specialty) {
    results = results.filter((v) => v.specialties.includes(params.specialty!));
  }
  if (params.species) {
    results = results.filter((v) => v.acceptedSpecies.includes(params.species!));
  }
  if (params.mode) {
    results = results.filter((v) => v.consultModes.includes(params.mode!));
  }
  if (params.emergencyOnly) {
    results = results.filter((v) => v.emergencyAvailable);
  }
  if (origin && params.radiusMiles != null) {
    results = results.filter(
      (v) => (v.distanceMiles ?? Infinity) <= params.radiusMiles!
    );
  }

  results.sort((a, b) =>
    origin
      ? (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0)
      : b.rating - a.rating
  );

  return results;
}

export async function getVetById(id: string, db: PrismaClient = defaultPrisma) {
  const v = await db.vetProfile.findUnique({
    where: { id },
    include: withRelations,
  });
  return v ? toVetWithUser(v) : null;
}

export async function getVetByUserId(
  userId: string,
  db: PrismaClient = defaultPrisma
) {
  const v = await db.vetProfile.findUnique({
    where: { userId },
    include: { availability: true },
  });
  return v ? toVetProfile(v) : null;
}

/**
 * Upsert the signed-in vet's own profile. `availability` is a relation, so when
 * the patch includes it we replace the whole set — same semantics as the
 * caretaker profile editor.
 *
 * Note what a vet may NOT set: `rating` and `reviewCount` are derived from
 * reviews, so they're absent from VetPatchBody and can't be talked up here.
 */
export async function upsertVetProfile(
  userId: string,
  patch: VetPatchBody,
  db: PrismaClient = defaultPrisma
) {
  const existing = await db.vetProfile.findUnique({ where: { userId } });
  const { clinic, availability, ...scalars } = patch;

  const scalarData = {
    ...scalars,
    ...(clinic
      ? {
          clinicName: clinic.name,
          clinicCity: clinic.city,
          clinicState: clinic.state,
          lat: clinic.lat,
          lng: clinic.lng,
        }
      : {}),
  };

  const id = await db.$transaction(async (tx) => {
    const profileId = existing?.id ?? `v_${globalThis.crypto.randomUUID()}`;

    if (!existing) {
      await tx.vetProfile.create({
        data: {
          id: profileId,
          userId,
          clinicName: "",
          bio: "",
          specialties: [],
          licenseNumber: "",
          licenseState: "",
          yearsExperience: 0,
          acceptedSpecies: [],
          consultModes: [],
          consultFee: 0,
          emergencyAvailable: false,
          clinicCity: "",
          clinicState: "",
          lat: 0,
          lng: 0,
          ...scalarData,
        },
      });
    } else if (Object.keys(scalarData).length > 0) {
      await tx.vetProfile.update({ where: { id: profileId }, data: scalarData });
    }

    if (availability) {
      await tx.vetAvailabilityDay.deleteMany({ where: { vetId: profileId } });
      if (availability.length > 0) {
        await tx.vetAvailabilityDay.createMany({
          data: availability.map((d) => ({
            vetId: profileId,
            date: d.date,
            slots: d.slots,
          })),
        });
      }
    }

    return profileId;
  });

  const fresh = await db.vetProfile.findUnique({
    where: { id },
    include: { availability: true },
  });
  return toVetProfile(fresh!);
}
