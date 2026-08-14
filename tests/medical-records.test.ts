import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  activePrescriptions,
  authorizedProductSlugs,
  createRecord,
  deleteRecord,
  getRecordById,
  getRecordsForPet,
  ownerMayAuthor,
} from "@/lib/server/medical-records";

beforeAll(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("record reads", () => {
  it("lists a pet's records newest-first", async () => {
    const records = await getRecordsForPet("p4", db);
    expect(records.length).toBe(3);
    for (let i = 1; i < records.length; i++) {
      expect(records[i - 1].occurredAt >= records[i].occurredAt).toBe(true);
    }
  });

  it("returns [] for a pet with no records", async () => {
    expect(await getRecordsForPet("p3", db)).toEqual([]);
  });

  it("gets a record by id, preserving the prescription fields", async () => {
    const r = await getRecordById("mr2", db);
    expect(r!.type).toBe("prescription");
    expect(r!.refillsLeft).toBe(3);
    expect(r!.productSlugs).toEqual(["vetline-hypoallergenic-cat-dry"]);
  });

  it("returns null for an unknown record", async () => {
    expect(await getRecordById("nope", db)).toBeNull();
  });
});

describe("who may author what", () => {
  it("lets an owner record allergies and weights", () => {
    expect(ownerMayAuthor("allergy")).toBe(true);
    expect(ownerMayAuthor("weight")).toBe(true);
  });

  it("reserves clinical entry types for vets", () => {
    expect(ownerMayAuthor("prescription")).toBe(false);
    expect(ownerMayAuthor("visit_note")).toBe(false);
    expect(ownerMayAuthor("vaccination")).toBe(false);
    expect(ownerMayAuthor("lab_result")).toBe(false);
  });
});

describe("active prescriptions", () => {
  it("returns a prescription that has not expired", async () => {
    const active = await activePrescriptions("p4", "2026-07-08T00:00:00Z", db);
    expect(active.map((r) => r.id)).toEqual(["mr2"]);
  });

  it("excludes a prescription once its expiry has passed", async () => {
    // mr2 expires 2026-12-20
    const active = await activePrescriptions("p4", "2027-01-01T00:00:00Z", db);
    expect(active).toEqual([]);
  });

  it("ignores non-prescription records", async () => {
    // p1 has vaccinations only
    expect(await activePrescriptions("p1", "2026-07-08T00:00:00Z", db)).toEqual([]);
  });

  it("maps prescriptions to the product slugs they authorise", async () => {
    const slugs = await authorizedProductSlugs("p4", "2026-07-08T00:00:00Z", db);
    expect(slugs.has("vetline-hypoallergenic-cat-dry")).toBe(true);
    expect(slugs.has("vetline-urinary-so-cat-wet")).toBe(false);
  });

  it("authorises nothing for a pet with no prescriptions", async () => {
    const slugs = await authorizedProductSlugs("p1", "2026-07-08T00:00:00Z", db);
    expect(slugs.size).toBe(0);
  });
});

describe("record writes", () => {
  beforeEach(async () => {
    await resetToSnapshot(db);
  });

  it("creates a vet-authored record stamped with the vet profile", async () => {
    const created = await createRecord(
      "p1",
      "u17",
      "v1",
      {
        type: "vaccination",
        title: "Rabies booster",
        details: "Given early at the wellness visit.",
        occurredAt: "2026-07-12T16:15:00Z",
        appointmentId: "a3",
        nextDueAt: "2029-07-12T00:00:00Z",
        medicationName: null,
        dosage: null,
        refillsLeft: null,
        expiresAt: null,
        productSlugs: [],
      },
      db
    );
    expect(created.id).toMatch(/^mr_/);
    expect(created.vetId).toBe("v1");
    expect(created.authorUserId).toBe("u17");
    expect(created.createdAt).toBeTruthy();
  });

  it("creates an owner-authored record with no vet attached", async () => {
    const created = await createRecord(
      "p1",
      "u1",
      null,
      {
        type: "weight",
        title: "Weight recorded: 70 lb",
        details: "",
        occurredAt: "2026-07-08T08:00:00Z",
        appointmentId: null,
        nextDueAt: null,
        medicationName: null,
        dosage: null,
        refillsLeft: null,
        expiresAt: null,
        productSlugs: [],
      },
      db
    );
    expect(created.vetId).toBeNull();
    expect(created.authorUserId).toBe("u1");
  });

  it("stops authorising a product once the refills run out", async () => {
    await db.medicalRecord.update({
      where: { id: "mr2" },
      data: { refillsLeft: 0 },
    });
    const slugs = await authorizedProductSlugs("p4", "2026-07-08T00:00:00Z", db);
    expect(slugs.size).toBe(0);
  });

  it("deletes a record", async () => {
    await deleteRecord("mr3", db);
    expect(await getRecordById("mr3", db)).toBeNull();
  });

  it("cascades records away when the pet is deleted", async () => {
    await db.vetAppointment.deleteMany({ where: { petId: "p4" } });
    await db.pet.delete({ where: { id: "p4" } });
    expect(await getRecordsForPet("p4", db)).toEqual([]);
  });
});
