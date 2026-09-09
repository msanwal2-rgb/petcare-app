/**
 * Adoption listings — server logic.
 *
 * A listing is a thin wrapper around an animal the shelter already owns. The
 * `Pet` row is the animal; this says it is available, what it costs, and the
 * things an adopter filters on.
 *
 * Search paginates in Postgres, following `searchProducts` rather than the
 * caretaker/vet in-memory style — a directory of adoptable animals grows
 * without bound and the grid only ever shows a page of it.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toAdoptionListing, toPet } from "../serialize";
import { genId, nowIso } from "../ids";
import { distanceMiles } from "@/lib/utils";
import type {
  AdoptionListingPage,
  AdoptionListingWithPet,
  ListingStatus,
} from "@/types";
import type {
  AdoptionListingBody,
  AdoptionListingQuery,
} from "@/lib/validation/schemas";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/**
 * Which moves are legal. Small enough to read at a glance, which is why it is
 * here rather than in a table of its own like the booking machine.
 *
 * `adopted → available` is the relist path: animals do come back, and without
 * it the only way to re-offer one would be the ownership backdoor this feature
 * closed.
 */
const TRANSITIONS: Record<ListingStatus, ListingStatus[]> = {
  draft: ["available", "withdrawn"],
  available: ["pending", "withdrawn"],
  pending: ["available", "adopted", "withdrawn"],
  adopted: ["available"],
  withdrawn: ["available"],
};

export function canTransitionListing(
  from: ListingStatus,
  to: ListingStatus
): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

const withPet = { pet: true } as const;

function toWithPet(
  row: Prisma.AdoptionListingGetPayload<{ include: typeof withPet }>,
  shelterName: string,
  origin?: { lat: number; lng: number }
): AdoptionListingWithPet {
  const listing = toAdoptionListing(row);
  return {
    ...listing,
    pet: toPet(row.pet),
    shelterName,
    distanceMiles: origin ? distanceMiles(origin, listing.location) : undefined,
  };
}

function whereFor(params: AdoptionListingQuery): Prisma.AdoptionListingWhereInput {
  // Only what is actually on offer. A draft is the shelter's business and a
  // withdrawn or adopted animal is nobody's.
  const where: Prisma.AdoptionListingWhereInput = { status: "available" };

  if (params.shelterId) where.shelterId = params.shelterId;
  if (params.energyLevel) where.energyLevel = params.energyLevel;
  if (params.maxFeeCents != null) where.feeCents = { lte: params.maxFeeCents };

  // These three filter for a definite yes. "unknown" is not good enough for
  // somebody asking because they have a toddler.
  if (params.goodWithKids) where.goodWithKids = "yes";
  if (params.goodWithDogs) where.goodWithDogs = "yes";
  if (params.goodWithCats) where.goodWithCats = "yes";

  if (params.species) where.pet = { species: params.species };

  if (params.q) {
    const q = params.q.trim();
    where.OR = [
      { headline: { contains: q, mode: "insensitive" } },
      { story: { contains: q, mode: "insensitive" } },
      { pet: { name: { contains: q, mode: "insensitive" } } },
      { pet: { breed: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

export async function searchListings(
  params: AdoptionListingQuery = {},
  db: PrismaClient = defaultPrisma
): Promise<AdoptionListingPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;
  const where = whereFor(params);

  const [rows, total] = await Promise.all([
    db.adoptionListing.findMany({
      where,
      include: withPet,
      // Longest-waiting first. An adoption directory that leads with the newest
      // arrivals is one where the animals who need it most are never seen.
      orderBy: { intakeAt: "asc" },
      take: limit,
      skip: offset,
    }),
    db.adoptionListing.count({ where }),
  ]);

  const shelterNames = await shelterNamesFor(rows.map((r) => r.shelterId), db);
  const origin =
    params.lat !== undefined && params.lng !== undefined
      ? { lat: params.lat, lng: params.lng }
      : undefined;

  let items = rows.map((r) =>
    toWithPet(r, shelterNames.get(r.shelterId) ?? "A shelter", origin)
  );

  // Radius filtering happens after the page is fetched, so it can shrink a
  // page. Distance is not a column and making it one is a PostGIS-shaped
  // change; this stays honest about `total` being the pre-radius count.
  if (origin && params.radiusMiles !== undefined) {
    const radius = params.radiusMiles;
    items = items.filter((l) => (l.distanceMiles ?? 0) <= radius);
  }
  if (origin) {
    items.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
  }

  return { items, total, limit, offset };
}

async function shelterNamesFor(
  ids: string[],
  db: PrismaClient
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.shelterProfile.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function getListingById(
  id: string,
  db: PrismaClient = defaultPrisma
): Promise<AdoptionListingWithPet | null> {
  const row = await db.adoptionListing.findUnique({
    where: { id },
    include: withPet,
  });
  if (!row) return null;
  const names = await shelterNamesFor([row.shelterId], db);
  return toWithPet(row, names.get(row.shelterId) ?? "A shelter");
}

/** Everything this shelter has listed, in any state — their own queue. */
export async function getListingsByShelter(
  shelterId: string,
  db: PrismaClient = defaultPrisma
): Promise<AdoptionListingWithPet[]> {
  const rows = await db.adoptionListing.findMany({
    where: { shelterId },
    include: withPet,
    orderBy: { createdAt: "desc" },
  });
  const names = await shelterNamesFor([shelterId], db);
  return rows.map((r) => toWithPet(r, names.get(shelterId) ?? "A shelter"));
}

export type ListingResult =
  | { ok: true; listing: AdoptionListingWithPet }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_yours" }
  | { ok: false; code: "pet_not_yours"; ownerId: string }
  | { ok: false; code: "already_listed" }
  | { ok: false; code: "invalid_transition"; from: ListingStatus; to: ListingStatus };

/**
 * Offer an animal for adoption.
 *
 * The shelter must own the pet. That check is the join between the two halves
 * of this feature: a listing is a claim about an animal, and a shelter may only
 * make it about an animal that is actually theirs.
 */
export async function createListing(
  shelterId: string,
  input: AdoptionListingBody,
  db: PrismaClient = defaultPrisma
): Promise<ListingResult> {
  const shelter = await db.shelterProfile.findUnique({
    where: { id: shelterId },
    select: { userId: true, city: true, state: true, lat: true, lng: true },
  });
  if (!shelter) return { ok: false, code: "not_found" };

  const pet = await db.pet.findUnique({ where: { id: input.petId } });
  if (!pet) return { ok: false, code: "not_found" };
  if (pet.ownerId !== shelter.userId) {
    return { ok: false, code: "pet_not_yours", ownerId: pet.ownerId };
  }

  const existing = await db.adoptionListing.findUnique({
    where: { petId: input.petId },
  });
  if (existing) return { ok: false, code: "already_listed" };

  const now = nowIso();
  const created = await db.adoptionListing.create({
    data: {
      id: genId("al"),
      shelterId,
      petId: input.petId,
      status: "draft",
      feeCents: input.feeCents ?? 0,
      headline: input.headline ?? "",
      story: input.story ?? "",
      goodWithKids: input.goodWithKids ?? "unknown",
      goodWithDogs: input.goodWithDogs ?? "unknown",
      goodWithCats: input.goodWithCats ?? "unknown",
      houseTrained: input.houseTrained ?? "unknown",
      energyLevel: input.energyLevel ?? "moderate",
      specialNeeds: input.specialNeeds ?? false,
      specialNeedsNotes: input.specialNeedsNotes ?? "",
      spayedNeutered: input.spayedNeutered ?? false,
      microchipped: input.microchipped ?? false,
      // Defaults to the shelter's own address; a fostered animal overrides it.
      city: input.city ?? shelter.city,
      state: input.state ?? shelter.state,
      lat: input.lat ?? shelter.lat,
      lng: input.lng ?? shelter.lng,
      intakeAt: input.intakeAt ?? now,
      createdAt: now,
      updatedAt: now,
    },
    include: withPet,
  });

  const names = await shelterNamesFor([shelterId], db);
  return {
    ok: true,
    listing: toWithPet(created, names.get(shelterId) ?? "A shelter"),
  };
}

export async function updateListing(
  id: string,
  actorUserId: string,
  patch: Partial<AdoptionListingBody>,
  db: PrismaClient = defaultPrisma
): Promise<ListingResult> {
  const row = await db.adoptionListing.findUnique({ where: { id } });
  if (!row) return { ok: false, code: "not_found" };

  const shelter = await db.shelterProfile.findUnique({
    where: { id: row.shelterId },
    select: { userId: true },
  });
  if (shelter?.userId !== actorUserId) return { ok: false, code: "not_yours" };

  const { petId: _petId, ...rest } = patch;
  await db.adoptionListing.update({
    where: { id },
    data: { ...rest, updatedAt: nowIso() },
  });

  const fresh = await getListingById(id, db);
  return { ok: true, listing: fresh! };
}

export async function setListingStatus(
  id: string,
  status: ListingStatus,
  actorUserId: string,
  db: PrismaClient = defaultPrisma
): Promise<ListingResult> {
  const row = await db.adoptionListing.findUnique({ where: { id } });
  if (!row) return { ok: false, code: "not_found" };

  const shelter = await db.shelterProfile.findUnique({
    where: { id: row.shelterId },
    select: { userId: true },
  });
  if (shelter?.userId !== actorUserId) return { ok: false, code: "not_yours" };

  const from = row.status as ListingStatus;
  if (!canTransitionListing(from, status)) {
    return { ok: false, code: "invalid_transition", from, to: status };
  }

  // Publishing asserts the claim again: an animal already adopted out cannot be
  // offered a second time by editing a row.
  if (status === "available") {
    const pet = await db.pet.findUnique({
      where: { id: row.petId },
      select: { ownerId: true },
    });
    if (pet?.ownerId !== shelter.userId) {
      return { ok: false, code: "pet_not_yours", ownerId: pet?.ownerId ?? "" };
    }
  }

  const now = nowIso();
  await db.adoptionListing.update({
    where: { id },
    data: {
      status,
      ...(status === "available" && !row.publishedAt ? { publishedAt: now } : {}),
      ...(status === "adopted" || status === "withdrawn" ? { closedAt: now } : {}),
      // Relisting reopens the row rather than creating a second one.
      ...(status === "available" && row.closedAt ? { closedAt: null } : {}),
      updatedAt: now,
    },
  });

  const fresh = await getListingById(id, db);
  return { ok: true, listing: fresh! };
}
