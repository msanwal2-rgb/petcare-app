import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  getProductBySlug,
  getProductsByIds,
  hasAllergen,
  lifeStageFor,
  listBrands,
  recommendedForPet,
  searchProducts,
} from "@/lib/server/products";

beforeAll(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("catalog search", () => {
  it("returns a page of active products with a total", async () => {
    const page = await searchProducts({}, db);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.total).toBe(25);
    expect(page.limit).toBe(24);
    expect(page.offset).toBe(0);
  });

  it("paginates", async () => {
    const first = await searchProducts({ limit: 5, offset: 0 }, db);
    const second = await searchProducts({ limit: 5, offset: 5 }, db);
    expect(first.items).toHaveLength(5);
    expect(second.items).toHaveLength(5);
    const overlap = first.items.filter((a) =>
      second.items.some((b) => b.id === a.id)
    );
    expect(overlap).toEqual([]);
  });

  it("caps an absurd limit rather than dumping the catalog", async () => {
    const page = await searchProducts({ limit: 5000 }, db);
    expect(page.limit).toBe(100);
  });

  it("filters by category", async () => {
    const page = await searchProducts({ category: "treats" }, db);
    expect(page.items.every((p) => p.category === "treats")).toBe(true);
    expect(page.items.length).toBe(3);
  });

  it("filters by species", async () => {
    const page = await searchProducts({ species: "cat" }, db);
    expect(page.items.every((p) => p.species.includes("cat"))).toBe(true);
  });

  it("treats a life stage of 'all' as matching every stage", async () => {
    const page = await searchProducts({ species: "dog", lifeStage: "puppy" }, db);
    const slugs = page.items.map((p) => p.slug);
    expect(slugs).toContain("summit-trail-puppy-dry"); // puppy-specific
    expect(slugs).toContain("barkside-peanut-butter-biscuits"); // lifeStage: all
    expect(slugs).not.toContain("silverpaw-senior-dry-dog");
  });

  it("filters by brand", async () => {
    const page = await searchProducts({ brand: "VetLine" }, db);
    expect(page.items.every((p) => p.brand === "VetLine")).toBe(true);
    expect(page.total).toBe(3);
  });

  it("filters by price range in cents", async () => {
    const page = await searchProducts({ minPriceCents: 1000, maxPriceCents: 3000 }, db);
    expect(
      page.items.every((p) => p.priceCents >= 1000 && p.priceCents <= 3000)
    ).toBe(true);
  });

  it("searches name, brand and description case-insensitively", async () => {
    const byName = await searchProducts({ q: "salmon" }, db);
    expect(byName.items.length).toBeGreaterThan(0);
    const byBrand = await searchProducts({ q: "barkside" }, db);
    expect(byBrand.items.every((p) => p.brand === "Barkside")).toBe(true);
  });

  it("sorts by price ascending and descending", async () => {
    const asc = await searchProducts({ sort: "price_asc" }, db);
    for (let i = 1; i < asc.items.length; i++) {
      expect(asc.items[i - 1].priceCents <= asc.items[i].priceCents).toBe(true);
    }
    const desc = await searchProducts({ sort: "price_desc" }, db);
    expect(desc.items[0].priceCents).toBeGreaterThanOrEqual(
      asc.items[0].priceCents
    );
  });

  it("combines filters", async () => {
    const page = await searchProducts(
      { species: "cat", category: "prescription_diet" },
      db
    );
    expect(page.items.every((p) => p.requiresPrescription)).toBe(true);
  });
});

describe("catalog reads", () => {
  it("gets a product by slug", async () => {
    const p = await getProductBySlug("summit-trail-salmon-dry-dog", db);
    expect(p!.brand).toBe("Summit Trail");
    expect(p!.priceCents).toBe(6499);
  });

  it("returns null for an unknown slug", async () => {
    expect(await getProductBySlug("nope", db)).toBeNull();
  });

  it("batch-resolves by id", async () => {
    const items = await getProductsByIds(["prod1", "prod13"], db);
    expect(items.map((p) => p.id).sort()).toEqual(["prod1", "prod13"]);
  });

  it("returns [] for an empty id list without hitting the db", async () => {
    expect(await getProductsByIds([], db)).toEqual([]);
  });

  it("lists distinct brands alphabetically", async () => {
    const brands = await listBrands(db);
    expect(brands).toContain("VetLine");
    expect([...brands].sort()).toEqual(brands);
    expect(new Set(brands).size).toBe(brands.length);
  });
});

describe("allergen matching", () => {
  it("matches an exact allergen", () => {
    expect(hasAllergen(["Chicken"], ["chicken"])).toBe(true);
  });

  it("matches when the product's wording is longer than the owner's", () => {
    expect(hasAllergen(["Chicken by-product meal"], ["chicken"])).toBe(true);
  });

  it("matches when the owner's wording is longer than the product's", () => {
    expect(hasAllergen(["Beef"], ["beef and lamb"])).toBe(true);
  });

  it("does not match unrelated ingredients", () => {
    expect(hasAllergen(["Fish", "Turkey"], ["chicken"])).toBe(false);
  });

  it("does not match when the pet has no allergies", () => {
    expect(hasAllergen(["Chicken"], [])).toBe(false);
  });
});

describe("life stage inference", () => {
  const iso = (yearsAgo: number) =>
    new Date(Date.now() - yearsAgo * 365.25 * 86_400_000).toISOString();

  it("calls a dog under a year a puppy", () => {
    expect(lifeStageFor({ species: "dog", dob: iso(0.5) })).toBe("puppy");
  });

  it("calls a cat under a year a kitten", () => {
    expect(lifeStageFor({ species: "cat", dob: iso(0.5) })).toBe("kitten");
  });

  it("calls a three-year-old an adult", () => {
    expect(lifeStageFor({ species: "dog", dob: iso(3) })).toBe("adult");
  });

  it("calls a ten-year-old a senior", () => {
    expect(lifeStageFor({ species: "dog", dob: iso(10) })).toBe("senior");
  });
});

describe("recommendations for a pet", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("only suggests products for the pet's species", async () => {
    const items = await recommendedForPet(
      { species: "cat", dob: "2020-09-30", allergies: [] },
      8,
      db
    );
    expect(items.every((p) => p.species.includes("cat"))).toBe(true);
  });

  it("excludes anything containing an ingredient the pet reacts to", async () => {
    // Luna reacts to chicken and grains
    const items = await recommendedForPet(
      { species: "cat", dob: "2020-09-30", allergies: ["Chicken", "Certain grains"] },
      8,
      db
    );
    expect(items.map((p) => p.slug)).not.toContain("meadowlark-chicken-dry-cat");
    expect(items.map((p) => p.slug)).not.toContain("whiskerwell-catnip-crunchies");
  });

  it("never suggests a prescription-only product", async () => {
    const items = await recommendedForPet(
      { species: "cat", dob: "2020-09-30", allergies: [] },
      20,
      db
    );
    expect(items.every((p) => !p.requiresPrescription)).toBe(true);
  });

  it("never suggests something out of stock", async () => {
    const items = await recommendedForPet(
      { species: "dog", dob: "2021-05-12", allergies: [] },
      20,
      db
    );
    // hearth-slow-feeder-bowl is seeded with zero stock
    expect(items.map((p) => p.slug)).not.toContain("hearth-slow-feeder-bowl");
  });

  it("respects the limit", async () => {
    const items = await recommendedForPet(
      { species: "dog", dob: "2021-05-12", allergies: [] },
      3,
      db
    );
    expect(items).toHaveLength(3);
  });
});
