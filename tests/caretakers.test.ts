import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  getCaretakerById,
  getCaretakerByUserId,
  searchCaretakers,
  upsertCaretakerProfile,
} from "@/lib/server/caretakers";

// Austin, TX — origin used for distance-sorted searches.
const AUSTIN = { lat: 30.2672, lng: -97.7431 };

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("caretaker search", () => {
  it("returns all caretakers sorted by rating when no origin given", async () => {
    const results = await searchCaretakers({}, db);
    expect(results.length).toBe(10);
    // c4 has the 5.0 rating → first
    expect(results[0].rating).toBe(5.0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rating).toBeGreaterThanOrEqual(results[i].rating);
    }
    // joined + computed fields present
    expect(results[0].user).toBeDefined();
    expect(results[0].priceRange.min).toBeLessThanOrEqual(results[0].priceRange.max);
    expect(results[0].distanceMiles).toBeUndefined();
  });

  it("sorts by distance ascending when lat/lng provided", async () => {
    const results = await searchCaretakers({ ...AUSTIN }, db);
    expect(results[0].distanceMiles).toBeDefined();
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].distanceMiles!).toBeLessThanOrEqual(
        results[i].distanceMiles!
      );
    }
  });

  it("filters by service type", async () => {
    const results = await searchCaretakers({ serviceType: "boarding" }, db);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.servicesOffered.includes("boarding"))).toBe(true);
  });

  it("filters by accepted species", async () => {
    const results = await searchCaretakers({ species: "other" }, db);
    expect(results.every((c) => c.acceptedSpecies.includes("other"))).toBe(true);
  });

  it("filters by price range", async () => {
    const results = await searchCaretakers({ minPrice: 60, maxPrice: 100 }, db);
    expect(
      results.every((c) => c.priceRange.max >= 60 && c.priceRange.min <= 100)
    ).toBe(true);
  });

  it("filters by radius around an origin", async () => {
    const all = await searchCaretakers({ ...AUSTIN }, db);
    const near = await searchCaretakers({ ...AUSTIN, radiusMiles: 5 }, db);
    expect(near.length).toBeLessThanOrEqual(all.length);
    expect(near.every((c) => (c.distanceMiles ?? Infinity) <= 5)).toBe(true);
  });

  it("filters by availability start date", async () => {
    const results = await searchCaretakers({ startDate: "2026-07-08" }, db);
    expect(
      results.every((c) =>
        c.availability.some((d) => d.date >= "2026-07-08" && d.slots.length > 0)
      )
    ).toBe(true);
  });

  it("combines multiple filters", async () => {
    const results = await searchCaretakers(
      { ...AUSTIN, serviceType: "walking", radiusMiles: 20, maxPrice: 30 },
      db
    );
    expect(
      results.every(
        (c) =>
          c.servicesOffered.includes("walking") &&
          (c.distanceMiles ?? Infinity) <= 20 &&
          c.priceRange.min <= 30
      )
    ).toBe(true);
  });

  it("returns [] when filters match nothing", async () => {
    const results = await searchCaretakers({ minPrice: 100000 }, db);
    expect(results).toEqual([]);
  });
});

describe("caretaker detail + profile", () => {
  it("gets a caretaker with its user join", async () => {
    const c = await getCaretakerById("c1", db);
    expect(c!.user.name).toBe("Liam Novak");
    expect(c!.pricing.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown caretaker", async () => {
    expect(await getCaretakerById("nope", db)).toBeNull();
  });

  it("gets a caretaker profile by userId", async () => {
    const c = await getCaretakerByUserId("u7", db);
    expect(c!.id).toBe("c1");
  });

  it("returns null when a user has no caretaker profile", async () => {
    expect(await getCaretakerByUserId("u1", db)).toBeNull();
  });

  it("creates a profile on first upsert, then updates it", async () => {
    // u1 has no profile yet → create path
    const created = await upsertCaretakerProfile(
      "u1",
      { bio: "Hello", servicesOffered: ["walking"] },
      db
    );
    expect(created.userId).toBe("u1");
    expect(created.bio).toBe("Hello");
    expect(created.backgroundCheckStatus).toBe("none"); // default

    // second upsert → update path
    const updated = await upsertCaretakerProfile("u1", { bio: "Updated" }, db);
    expect(updated.bio).toBe("Updated");
    expect(updated.servicesOffered).toEqual(["walking"]); // unchanged
  });

  it("replaces pricing and availability sets on upsert", async () => {
    const updated = await upsertCaretakerProfile(
      "u7",
      {
        pricing: [{ serviceType: "walking", unit: "hour", rate: 99 }],
        availability: [
          { date: "2026-08-01", slots: [{ start: "09:00", end: "12:00" }] },
        ],
      },
      db
    );
    expect(updated.pricing).toEqual([
      { serviceType: "walking", unit: "hour", rate: 99 },
    ]);
    expect(updated.availability.length).toBe(1);
    expect(updated.availability[0].date).toBe("2026-08-01");
  });

  it("updates nested homeEnvironment fields", async () => {
    const updated = await upsertCaretakerProfile(
      "u7",
      { homeEnvironment: { fencedYard: false, hasOtherPets: false, smokeFree: false } },
      db
    );
    expect(updated.homeEnvironment).toEqual({
      fencedYard: false,
      hasOtherPets: false,
      smokeFree: false,
    });
  });
});
