import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  createPet,
  getPetById,
  getPetsByIds,
  getPetsByOwner,
  updatePet,
} from "@/lib/server/pets";

const petInput = {
  name: "New Pet",
  species: "dog" as const,
  breed: "Beagle",
  sex: "female" as const,
  dob: "2024-01-01",
  weightLbs: 20,
  photoUrl: "https://example.com/p.jpg",
  vaccinated: true,
  allergies: [] as string[],
  medications: [] as string[],
  behaviorNotes: "Curious",
  feedingInstructions: "1 cup twice daily",
  vetContact: { name: "Vet", phone: "(555) 000-0000" },
};

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("pets", () => {
  it("lists an owner's pets", async () => {
    const pets = await getPetsByOwner("u1", db);
    expect(pets.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("returns [] for an owner with no pets", async () => {
    expect(await getPetsByOwner("u7", db)).toEqual([]);
  });

  it("returns a pet with nested vetContact and arrays", async () => {
    const p = await getPetById("p4", db);
    expect(p!.name).toBe("Luna");
    expect(p!.allergies).toContain("Chicken");
    expect(p!.medications.length).toBeGreaterThan(0);
    expect(p!.vetContact).toEqual({
      name: "Cherry Creek Veterinary",
      phone: "(303) 555-0722",
    });
  });

  it("returns null for an unknown pet", async () => {
    expect(await getPetById("nope", db)).toBeNull();
  });

  it("batch-resolves pets by id", async () => {
    const pets = await getPetsByIds(["p1", "p3", "p9"], db);
    expect(pets.length).toBe(3);
  });

  it("returns [] for an empty id list", async () => {
    expect(await getPetsByIds([], db)).toEqual([]);
  });

  it("creates a pet under the path owner", async () => {
    const created = await createPet("u1", petInput, db);
    expect(created.id).toMatch(/^p_/);
    expect(created.ownerId).toBe("u1");
    const pets = await getPetsByOwner("u1", db);
    expect(pets.length).toBe(3);
  });

  it("updates fields and nested vetContact", async () => {
    const updated = await updatePet(
      "p1",
      { weightLbs: 70, vetContact: { name: "New Vet", phone: "(1)" } },
      db
    );
    expect(updated!.weightLbs).toBe(70);
    expect(updated!.vetContact.name).toBe("New Vet");
  });

  it("returns null when updating an unknown pet", async () => {
    expect(await updatePet("ghost", { weightLbs: 1 }, db)).toBeNull();
  });
});
