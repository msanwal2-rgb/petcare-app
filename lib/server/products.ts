/**
 * Store catalog — server logic.
 *
 * Unlike the caretaker and vet searches, which filter a small set in memory,
 * this filters and paginates in Postgres: a catalog grows without bound and the
 * grid only ever shows a page of it.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { toProduct } from "./serialize";
import type { ProductPage, ProductSort } from "@/types";
import type { ProductQueryBody } from "@/lib/validation/schemas";

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const ORDER_BY: Record<ProductSort, Prisma.ProductOrderByWithRelationInput[]> = {
  // "Featured" leads with what's well reviewed and in stock rather than newest.
  featured: [{ rating: "desc" }, { reviewCount: "desc" }],
  price_asc: [{ priceCents: "asc" }],
  price_desc: [{ priceCents: "desc" }],
  rating: [{ rating: "desc" }, { reviewCount: "desc" }],
  newest: [{ createdAt: "desc" }],
};

function whereFor(params: ProductQueryBody): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { active: true };

  if (params.category) where.category = params.category;
  if (params.brand) where.brand = params.brand;
  if (params.species) where.species = { has: params.species };
  if (params.lifeStage) {
    // "all" on a product means it suits every life stage, so it always matches.
    where.lifeStage = { hasSome: [params.lifeStage, "all"] };
  }
  if (params.minPriceCents != null || params.maxPriceCents != null) {
    where.priceCents = {
      ...(params.minPriceCents != null ? { gte: params.minPriceCents } : {}),
      ...(params.maxPriceCents != null ? { lte: params.maxPriceCents } : {}),
    };
  }
  if (params.q) {
    const q = params.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { brand: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function searchProducts(
  params: ProductQueryBody = {},
  db: PrismaClient = defaultPrisma
): Promise<ProductPage> {
  const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = params.offset ?? 0;
  const where = whereFor(params);

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: ORDER_BY[params.sort ?? "featured"],
      take: limit,
      skip: offset,
    }),
    db.product.count({ where }),
  ]);

  return { items: rows.map(toProduct), total, limit, offset };
}

export async function getProductBySlug(
  slug: string,
  db: PrismaClient = defaultPrisma
) {
  const p = await db.product.findUnique({ where: { slug } });
  return p ? toProduct(p) : null;
}

export async function getProductsByIds(
  ids: string[],
  db: PrismaClient = defaultPrisma
) {
  if (ids.length === 0) return [];
  const rows = await db.product.findMany({ where: { id: { in: ids } } });
  return rows.map(toProduct);
}

/** Every distinct brand in the active catalog, for the filter rail. */
export async function listBrands(db: PrismaClient = defaultPrisma) {
  const rows = await db.product.findMany({
    where: { active: true },
    select: { brand: true },
    distinct: ["brand"],
    orderBy: { brand: "asc" },
  });
  return rows.map((r) => r.brand);
}

/**
 * Products worth putting in front of a particular pet: right species, right
 * life stage for its age, and nothing containing an ingredient it reacts to.
 *
 * The allergen match is deliberately loose (substring, case-insensitive) —
 * an owner writes "Chicken" and a product lists "chicken by-product meal".
 * Over-filtering here is the safe direction to be wrong in.
 */
export async function recommendedForPet(
  pet: { species: string; dob: string; allergies: string[] },
  limit = 8,
  db: PrismaClient = defaultPrisma
) {
  const rows = await db.product.findMany({
    where: {
      active: true,
      requiresPrescription: false,
      species: { has: pet.species },
      lifeStage: { hasSome: [lifeStageFor(pet), "all"] },
      stockQty: { gt: 0 },
    },
    orderBy: ORDER_BY.featured,
    take: limit * 3, // over-fetch, since the allergen filter runs after
  });

  const allergens = pet.allergies.map((a) => a.toLowerCase());
  const safe = rows.filter((p) => !hasAllergen(p.allergens, allergens));
  return safe.slice(0, limit).map(toProduct);
}

/** True when any of the product's allergens matches one the pet reacts to. */
export function hasAllergen(
  productAllergens: string[],
  petAllergensLower: string[]
): boolean {
  return productAllergens.some((pa) => {
    const a = pa.toLowerCase();
    return petAllergensLower.some((pet) => a.includes(pet) || pet.includes(a));
  });
}

/** Map a pet's age and species onto the catalog's life-stage buckets. */
export function lifeStageFor(pet: { species: string; dob: string }): string {
  const months =
    (Date.now() - new Date(pet.dob).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (months < 12) return pet.species === "cat" ? "kitten" : "puppy";
  if (months >= 96) return "senior"; // ~8 years
  return "adult";
}
