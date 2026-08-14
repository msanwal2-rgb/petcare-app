import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import { getVetById, getVetByUserId, searchVets, upsertVetProfile } from "@/lib/server/vets";

// Read-only specs share one seed; the mutating block below reseeds per test.
beforeAll(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("vet search", () => {
  it("returns every seeded vet when unfiltered", async () => {
    const results = await searchVets({}, db);
    expect(results.length).toBe(4);
    expect(results[0].user).toBeTruthy();
  });

  it("sorts by rating when no origin is given", async () => {
    const results = await searchVets({}, db);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rating >= results[i].rating).toBe(true);
    }
  });

  it("sorts by distance to the clinic when lat/lng are given", async () => {
    const results = await searchVets({ lat: 30.2672, lng: -97.7431 }, db);
    expect(results[0].clinic.city).toBe("Austin");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].distanceMiles! <= results[i].distanceMiles!).toBe(true);
    }
  });

  it("filters by specialty", async () => {
    const results = await searchVets({ specialty: "dermatology" }, db);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("v2");
  });

  it("filters by consult mode", async () => {
    const results = await searchVets({ mode: "home_visit" }, db);
    expect(results.map((v) => v.id)).toEqual(["v4"]);
  });

  it("filters by accepted species", async () => {
    const results = await searchVets({ species: "other" }, db);
    expect(results.map((v) => v.id)).toEqual(["v4"]);
  });

  it("filters to emergency-capable clinics only", async () => {
    const results = await searchVets({ emergencyOnly: true }, db);
    expect(results.every((v) => v.emergencyAvailable)).toBe(true);
    expect(results.length).toBe(2);
  });

  it("applies a radius around the origin", async () => {
    const near = await searchVets(
      { lat: 30.2672, lng: -97.7431, radiusMiles: 25 },
      db
    );
    expect(near.every((v) => v.clinic.state === "TX")).toBe(true);
  });

  it("combines filters", async () => {
    const results = await searchVets({ specialty: "general", species: "cat" }, db);
    expect(results.map((v) => v.id).sort()).toEqual(["v1", "v2", "v4"]);
  });
});

describe("vet reads", () => {
  it("gets a vet by profile id, joined with its user", async () => {
    const vet = await getVetById("v1", db);
    expect(vet!.clinicName).toBe("South Austin Animal Hospital");
    expect(vet!.user.name).toBe("Dr. Naomi Ruiz");
    expect(vet!.availability.length).toBeGreaterThan(0);
  });

  it("returns null for an unknown vet", async () => {
    expect(await getVetById("nope", db)).toBeNull();
  });

  it("gets a vet by user id", async () => {
    const vet = await getVetByUserId("u18", db);
    expect(vet!.id).toBe("v2");
  });

  it("returns null when the user has no vet profile", async () => {
    expect(await getVetByUserId("u1", db)).toBeNull();
  });

  it("sorts availability days chronologically", async () => {
    const vet = await getVetById("v1", db);
    const dates = vet!.availability.map((d) => d.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("vet profile upsert", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("patches scalar fields on an existing profile", async () => {
    const updated = await upsertVetProfile("u17", { bio: "New bio", consultFee: 95 }, db);
    expect(updated.bio).toBe("New bio");
    expect(updated.consultFee).toBe(95);
    // untouched fields survive
    expect(updated.specialties).toContain("general");
  });

  it("flattens the nested clinic object into columns", async () => {
    const updated = await upsertVetProfile(
      "u17",
      { clinic: { name: "New Clinic", city: "Round Rock", state: "TX", lat: 30.5, lng: -97.7 } },
      db
    );
    expect(updated.clinicName).toBe("New Clinic");
    expect(updated.clinic.city).toBe("Round Rock");
  });

  it("replaces the whole availability set rather than merging", async () => {
    const updated = await upsertVetProfile(
      "u17",
      { availability: [{ date: "2026-09-01", slots: [{ start: "09:00", end: "12:00" }] }] },
      db
    );
    expect(updated.availability).toHaveLength(1);
    expect(updated.availability[0].date).toBe("2026-09-01");
  });

  it("creates a profile for a user who has none yet", async () => {
    const created = await upsertVetProfile("u1", { bio: "Newly qualified" }, db);
    expect(created.id).toMatch(/^v_/);
    expect(created.userId).toBe("u1");
    expect(created.bio).toBe("Newly qualified");
    expect(created.consultFee).toBe(0);
  });

  it("leaves the profile untouched for an empty patch", async () => {
    const before = await getVetByUserId("u17", db);
    const after = await upsertVetProfile("u17", {}, db);
    expect(after).toEqual(before);
  });
});
