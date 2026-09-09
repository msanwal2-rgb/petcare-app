/**
 * Shelters domain — server logic.
 *
 * Deliberately mirrors lib/server/vets.ts, for the same reason that file
 * mirrors caretakers.ts: the two are the same shape of thing, and a reader who
 * knows one should recognise the other immediately. Where the two older
 * templates disagree, this follows the vet: option lists derive from label
 * maps, and the patch schema refuses the fields that are derived rather than
 * entered.
 *
 * Search filters in memory, like caretakers and vets and unlike the store —
 * there will be tens of shelters, not thousands, and the filters are over
 * fields the database would have to load anyway to compute distance.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toShelterProfile, toShelterWithUser } from "./serialize";
import { nowIso } from "./ids";
import { distanceMiles } from "@/lib/utils";
import type { ShelterProfile, ShelterWithUser, Species } from "@/types";
import type { ShelterPatchBody } from "@/lib/validation/schemas";

const withRelations = { user: true } as const;

export interface ShelterSearchParams {
  lat?: number;
  lng?: number;
  radiusMiles?: number;
  species?: Species;
  kind?: string;
  /** Only shelters with at least one animal available right now. */
  withAvailable?: boolean;
  verifiedOnly?: boolean;
}

/**
 * How many animals each of these shelters currently has available.
 *
 * One grouped count rather than a query per shelter — the listing count is on
 * every card, so the N+1 would be the page.
 */
async function availableCounts(
  shelterIds: string[],
  db: PrismaClient
): Promise<Map<string, number>> {
  if (shelterIds.length === 0) return new Map();
  const rows = await db.adoptionListing.groupBy({
    by: ["shelterId"],
    where: { shelterId: { in: shelterIds }, status: "available" },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.shelterId, r._count._all]));
}

export async function searchShelters(
  params: ShelterSearchParams = {},
  db: PrismaClient = defaultPrisma
): Promise<ShelterWithUser[]> {
  const rows = await db.shelterProfile.findMany({ include: withRelations });
  const counts = await availableCounts(
    rows.map((r) => r.id),
    db
  );

  const origin =
    params.lat !== undefined && params.lng !== undefined
      ? { lat: params.lat, lng: params.lng }
      : undefined;

  let results = rows.map((r) =>
    toShelterWithUser(r, counts.get(r.id) ?? 0, origin)
  );

  if (params.species) {
    results = results.filter((s) => s.acceptedSpecies.includes(params.species!));
  }
  if (params.kind) {
    results = results.filter((s) => s.kind === params.kind);
  }
  if (params.verifiedOnly) {
    results = results.filter((s) => s.verificationStatus === "verified");
  }
  if (params.withAvailable) {
    results = results.filter((s) => s.availableCount > 0);
  }
  if (origin && params.radiusMiles !== undefined) {
    const radius = params.radiusMiles;
    results = results.filter(
      (s) => distanceMiles(origin, s.address) <= radius
    );
  }

  // Nearest first when we know where the adopter is; otherwise the shelters
  // with animals to show, then the most responsive.
  results.sort((a, b) =>
    origin
      ? (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0)
      : b.availableCount - a.availableCount ||
        b.responseRatePct - a.responseRatePct
  );
  return results;
}

export async function getShelterById(
  id: string,
  db: PrismaClient = defaultPrisma
): Promise<ShelterWithUser | null> {
  const row = await db.shelterProfile.findUnique({
    where: { id },
    include: withRelations,
  });
  if (!row) return null;
  const counts = await availableCounts([row.id], db);
  return toShelterWithUser(row, counts.get(row.id) ?? 0);
}

/** Your own profile — no user join, because you are the user. */
export async function getShelterByUserId(
  userId: string,
  db: PrismaClient = defaultPrisma
): Promise<ShelterProfile | null> {
  const row = await db.shelterProfile.findUnique({ where: { userId } });
  return row ? toShelterProfile(row) : null;
}

/**
 * Create or update. Mirrors `upsertVetProfile`, including the blank-profile
 * defaults on first write, so a shelter that saves a half-filled form gets a
 * coherent row rather than a Prisma error about missing columns.
 */
export async function upsertShelterProfile(
  userId: string,
  patch: ShelterPatchBody,
  db: PrismaClient = defaultPrisma
): Promise<ShelterProfile> {
  const { address, ...scalars } = patch;
  const scalarData = {
    ...scalars,
    ...(address
      ? {
          addressLine: address.line,
          city: address.city,
          state: address.state,
          lat: address.lat,
          lng: address.lng,
        }
      : {}),
  };

  const existing = await db.shelterProfile.findUnique({ where: { userId } });

  if (!existing) {
    await db.shelterProfile.create({
      data: {
        id: `sh_${globalThis.crypto.randomUUID()}`,
        userId,
        name: "",
        bio: "",
        kind: "rescue",
        registrationNumber: "",
        registrationState: "",
        acceptedSpecies: [],
        websiteUrl: "",
        phone: "",
        email: "",
        addressLine: "",
        city: "",
        state: "",
        lat: 0,
        lng: 0,
        adoptionPolicy: "",
        createdAt: nowIso(),
        ...scalarData,
      },
    });
  } else if (Object.keys(scalarData).length > 0) {
    await db.shelterProfile.update({
      where: { userId },
      data: scalarData,
    });
  }

  const fresh = await db.shelterProfile.findUnique({ where: { userId } });
  return toShelterProfile(fresh!);
}
