/**
 * Caretakers domain — server logic. Mirrors the original mock's search
 * semantics exactly (filter → distance/rating sort), now backed by the DB.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toCaretakerProfile, toCaretakerWithUser } from "./serialize";
import type { CaretakerPatchBody } from "@/lib/validation/schemas";
import type { SearchParams } from "@/types";

const withRelations = {
  pricing: true,
  availability: true,
  user: true,
} as const;

export async function searchCaretakers(
  params: SearchParams = {},
  db: PrismaClient = defaultPrisma
) {
  const origin =
    params.lat != null && params.lng != null
      ? { lat: params.lat, lng: params.lng }
      : undefined;

  const rows = await db.caretakerProfile.findMany({ include: withRelations });
  let results = rows.map((c) => toCaretakerWithUser(c, origin));

  if (params.serviceType) {
    results = results.filter((c) => c.servicesOffered.includes(params.serviceType!));
  }
  if (params.species) {
    results = results.filter((c) => c.acceptedSpecies.includes(params.species!));
  }
  if (params.minPrice != null) {
    results = results.filter((c) => c.priceRange.max >= params.minPrice!);
  }
  if (params.maxPrice != null) {
    results = results.filter((c) => c.priceRange.min <= params.maxPrice!);
  }
  if (origin && params.radiusMiles != null) {
    results = results.filter(
      (c) => (c.distanceMiles ?? Infinity) <= params.radiusMiles!
    );
  }
  if (params.startDate) {
    results = results.filter((c) =>
      c.availability.some(
        (d) => d.date >= params.startDate! && d.slots.length > 0
      )
    );
  }

  results.sort((a, b) =>
    origin
      ? (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0)
      : b.rating - a.rating
  );

  return results;
}

export async function getCaretakerById(id: string, db: PrismaClient = defaultPrisma) {
  const c = await db.caretakerProfile.findUnique({
    where: { id },
    include: withRelations,
  });
  return c ? toCaretakerWithUser(c) : null;
}

export async function getCaretakerByUserId(
  userId: string,
  db: PrismaClient = defaultPrisma
) {
  const c = await db.caretakerProfile.findUnique({
    where: { userId },
    include: { pricing: true, availability: true },
  });
  return c ? toCaretakerProfile(c) : null;
}

/**
 * PATCH /api/caretakers/:id  (or create if the user has no profile yet).
 * pricing/availability are relations, so when the patch includes them we
 * replace the whole set — matching the mock's "assign the array" behavior.
 */
export async function upsertCaretakerProfile(
  userId: string,
  patch: CaretakerPatchBody,
  db: PrismaClient = defaultPrisma
) {
  const existing = await db.caretakerProfile.findUnique({ where: { userId } });
  const { homeEnvironment, pricing, availability, ...scalars } = patch;

  const scalarData = {
    ...scalars,
    ...(homeEnvironment ?? {}),
  };

  const id = await db.$transaction(async (tx) => {
    const profileId = existing?.id ?? `c_${globalThis.crypto.randomUUID()}`;

    if (!existing) {
      await tx.caretakerProfile.create({
        data: {
          id: profileId,
          userId,
          bio: "",
          servicesOffered: [],
          serviceRadiusMiles: 10,
          acceptedSpecies: [],
          fencedYard: false,
          hasOtherPets: false,
          smokeFree: true,
          certifications: [],
          backgroundCheckStatus: "none",
          rating: 0,
          reviewCount: 0,
          responseRatePct: 100,
          ...scalarData,
        },
      });
    } else if (Object.keys(scalarData).length > 0) {
      await tx.caretakerProfile.update({
        where: { id: profileId },
        data: scalarData,
      });
    }

    if (pricing) {
      await tx.pricingEntry.deleteMany({ where: { caretakerId: profileId } });
      if (pricing.length > 0) {
        await tx.pricingEntry.createMany({
          data: pricing.map((p) => ({ ...p, caretakerId: profileId })),
        });
      }
    }

    if (availability) {
      await tx.availabilityDay.deleteMany({ where: { caretakerId: profileId } });
      if (availability.length > 0) {
        await tx.availabilityDay.createMany({
          data: availability.map((d) => ({
            caretakerId: profileId,
            date: d.date,
            slots: d.slots,
          })),
        });
      }
    }

    return profileId;
  });

  const fresh = await db.caretakerProfile.findUnique({
    where: { id },
    include: { pricing: true, availability: true },
  });
  return toCaretakerProfile(fresh!);
}
