import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  canAccessPetRecords,
  canViewPet,
  ownsPet,
  isBookingParticipant,
  isAppointmentParticipant,
  ownsCaretakerProfile,
  ownsVetProfile,
} from "@/lib/server/access";
import { authorizedProductSlugs } from "@/lib/server/medical-records";
import { nowIso } from "@/lib/server/ids";

/**
 * The authorization predicates.
 *
 * `access.ts` was split out of `session.ts` specifically so these could be
 * exercised against a real schema — its header says being able to test them was
 * the point — and then no test file was ever written. This is it.
 *
 * The seeded relationships these lean on:
 *   p1  — Maya's (u1) dog
 *   b1  — booking for p1 with caretaker c1, whose user is u7
 *   a3  — appointment for p1 with vet v1, whose user is u17
 * Neither u7 nor u17 owns p1, which is the whole point: their access is derived
 * from the engagement, and it is what must end when the animal changes hands.
 */

const OWNER = "u1";
const PET = "p1";
const CARETAKER_USER = "u7";
const VET_USER = "u17";
const STRANGER = "u2";

/** What an adoption does, reduced to the one write that matters. */
async function transferTo(userId: string) {
  await db.pet.update({
    where: { id: PET },
    data: { ownerId: userId, ownedSince: nowIso() },
  });
}

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("ownsPet", () => {
  it("is true for the owner and false for everyone else", async () => {
    expect(await ownsPet(OWNER, PET, db)).toBe(true);
    expect(await ownsPet(STRANGER, PET, db)).toBe(false);
  });

  it("is false for a pet that does not exist", async () => {
    expect(await ownsPet(OWNER, "ghost", db)).toBe(false);
  });
});

describe("canViewPet", () => {
  it("lets the owner see their own animal", async () => {
    expect(await canViewPet(OWNER, PET, db)).toBe(true);
  });

  it("refuses a stranger", async () => {
    expect(await canViewPet(STRANGER, PET, db)).toBe(false);
  });

  it("lets a caretaker with a booking see it", async () => {
    // This is the grant that exists so a sitter can read feeding instructions.
    expect(await canViewPet(CARETAKER_USER, PET, db)).toBe(true);
  });

  it("lets a treating vet see it", async () => {
    expect(await canViewPet(VET_USER, PET, db)).toBe(true);
  });

  it("refuses a caretaker whose booking was declined", async () => {
    await db.booking.updateMany({
      where: { petIds: { has: PET } },
      data: { status: "declined" },
    });
    // The vet route still grants, so check the caretaker path in isolation.
    await db.vetAppointment.updateMany({
      where: { petId: PET },
      data: { status: "cancelled" },
    });
    expect(await canViewPet(CARETAKER_USER, PET, db)).toBe(false);
  });

  it("is false for a pet that does not exist", async () => {
    expect(await canViewPet(OWNER, "ghost", db)).toBe(false);
  });
});

describe("canAccessPetRecords", () => {
  it("gives the owner access, as themselves rather than as a vet", async () => {
    expect(await canAccessPetRecords(OWNER, PET, db)).toEqual({
      allowed: true,
      asVetId: null,
    });
  });

  it("gives a treating vet access, and tells the caller which vet", async () => {
    // `asVetId` is what write endpoints stamp records with, so it has to come
    // back rather than being looked up a second time.
    expect(await canAccessPetRecords(VET_USER, PET, db)).toEqual({
      allowed: true,
      asVetId: "v1",
    });
  });

  it("refuses a caretaker — a booking is not clinical access", async () => {
    expect(await canAccessPetRecords(CARETAKER_USER, PET, db)).toEqual({
      allowed: false,
      asVetId: null,
    });
  });

  it("refuses a stranger", async () => {
    expect(await canAccessPetRecords(STRANGER, PET, db)).toEqual({
      allowed: false,
      asVetId: null,
    });
  });
});

describe("ownership changes hands", () => {
  /**
   * The reason `ownedSince` exists.
   *
   * Every one of these passed *before* the column, which is what made adopting
   * an animal hand its previous owner's caretakers and vets a permanent key to
   * the new owner's household.
   */

  it("ends a caretaker's access", async () => {
    expect(await canViewPet(CARETAKER_USER, PET, db)).toBe(true);
    await transferTo(STRANGER);
    expect(await canViewPet(CARETAKER_USER, PET, db)).toBe(false);
  });

  it("ends a vet's record access", async () => {
    expect((await canAccessPetRecords(VET_USER, PET, db)).allowed).toBe(true);
    await transferTo(STRANGER);
    expect(await canAccessPetRecords(VET_USER, PET, db)).toEqual({
      allowed: false,
      asVetId: null,
    });
  });

  it("ends the previous owner's access", async () => {
    await transferTo(STRANGER);
    expect(await canViewPet(OWNER, PET, db)).toBe(false);
    expect((await canAccessPetRecords(OWNER, PET, db)).allowed).toBe(false);
  });

  it("gives the new owner access", async () => {
    await transferTo(STRANGER);
    expect(await ownsPet(STRANGER, PET, db)).toBe(true);
    expect(await canViewPet(STRANGER, PET, db)).toBe(true);
    expect((await canAccessPetRecords(STRANGER, PET, db)).allowed).toBe(true);
  });

  it("keeps the health record with the animal", async () => {
    const before = await db.medicalRecord.count({ where: { petId: PET } });
    await transferTo(STRANGER);
    const after = await db.medicalRecord.count({ where: { petId: PET } });
    // The records follow the pet — that is the whole point of adopting through
    // this app rather than a listings board. Only *access* is severed.
    expect(after).toBe(before);
  });

  it("restores a vet's access when they are booked again by the new owner", async () => {
    await transferTo(STRANGER);
    expect((await canAccessPetRecords(VET_USER, PET, db)).allowed).toBe(false);

    // A fresh engagement under the current owner grants cleanly, with no
    // special case — the timestamp comparison does all of it.
    await db.vetAppointment.create({
      data: {
        id: "a_after_transfer",
        ownerId: STRANGER,
        vetId: "v1",
        petId: PET,
        mode: "in_clinic",
        reason: "New owner's first visit",
        symptoms: [],
        startDateTime: new Date(Date.now() + 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 88_200_000).toISOString(),
        status: "confirmed",
        baseFee: 90,
        fee: 90,
        createdAt: nowIso(),
      },
    });
    expect((await canAccessPetRecords(VET_USER, PET, db)).allowed).toBe(true);
  });

  it("runs both ways, which is what makes a returned adoption safe", async () => {
    await transferTo(STRANGER);
    // Give the new owner their own vet engagement...
    await db.vetAppointment.create({
      data: {
        id: "a_new_owner",
        ownerId: STRANGER,
        vetId: "v2",
        petId: PET,
        mode: "in_clinic",
        reason: "Check-up",
        symptoms: [],
        startDateTime: new Date(Date.now() + 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 88_200_000).toISOString(),
        status: "confirmed",
        baseFee: 140,
        fee: 140,
        createdAt: nowIso(),
      },
    });
    const v2 = await db.vetProfile.findUnique({ where: { id: "v2" } });
    expect((await canAccessPetRecords(v2!.userId, PET, db)).allowed).toBe(true);

    // ...then reverse it. The adopter's vet loses access exactly as the
    // shelter's did. One mechanism, no second code path.
    await transferTo(OWNER);
    expect((await canAccessPetRecords(v2!.userId, PET, db)).allowed).toBe(false);
  });
});

describe("the store seam survives a transfer", () => {
  /**
   * An unexpired `prescription` naming a product slug is what unlocks Rx items
   * in the store. It is keyed on the pet, so it transfers with the animal — but
   * the vet's ability to write *new* ones must not.
   */

  it("carries existing prescriptions to the new owner", async () => {
    // p4 (Luna) is the seeded pet with a live prescription.
    const before = await authorizedProductSlugs("p4", undefined, db);
    expect(before.size).toBeGreaterThan(0);

    await db.pet.update({
      where: { id: "p4" },
      data: { ownerId: STRANGER, ownedSince: nowIso() },
    });

    const after = await authorizedProductSlugs("p4", undefined, db);
    expect([...after]).toEqual([...before]);
  });

  it("stops the old owner's vet writing new ones", async () => {
    const pet = await db.pet.findUnique({ where: { id: "p4" } });
    const appointment = await db.vetAppointment.findFirst({
      where: { petId: "p4" },
      select: { vetId: true },
    });
    const vet = await db.vetProfile.findUnique({
      where: { id: appointment!.vetId },
    });

    expect((await canAccessPetRecords(vet!.userId, "p4", db)).allowed).toBe(true);

    await db.pet.update({
      where: { id: "p4" },
      data: { ownerId: STRANGER, ownedSince: nowIso() },
    });

    // Without this, adopting an animal would hand every vet who ever treated it
    // a standing line of credit against the adopter's store account.
    expect((await canAccessPetRecords(vet!.userId, "p4", db)).allowed).toBe(false);
    expect(pet!.ownerId).not.toBe(STRANGER); // sanity: we really did move it
  });
});

describe("the seeded grants are grandfathered", () => {
  it("keeps a treating vet's access to a pet they do not own", async () => {
    // The canary for the migration's epoch backfill. Set `ownedSince` to seed
    // time instead and this fails first, along with the demo.
    const pet = await db.pet.findUnique({
      where: { id: PET },
      select: { ownedSince: true },
    });
    expect(pet!.ownedSince).toBe("1970-01-01T00:00:00.000Z");
    expect((await canAccessPetRecords(VET_USER, PET, db)).allowed).toBe(true);
  });
});

describe("the other predicates still hold", () => {
  it("recognises both sides of a booking", async () => {
    expect(await isBookingParticipant(OWNER, "b1", db)).toBe(true);
    expect(await isBookingParticipant(CARETAKER_USER, "b1", db)).toBe(true);
    expect(await isBookingParticipant(STRANGER, "b1", db)).toBe(false);
  });

  it("recognises both sides of an appointment", async () => {
    expect(await isAppointmentParticipant(OWNER, "a3", db)).toBe(true);
    expect(await isAppointmentParticipant(VET_USER, "a3", db)).toBe(true);
    expect(await isAppointmentParticipant(STRANGER, "a3", db)).toBe(false);
  });

  it("checks profile ownership", async () => {
    expect(await ownsCaretakerProfile(CARETAKER_USER, "c1", db)).toBe(true);
    expect(await ownsCaretakerProfile(STRANGER, "c1", db)).toBe(false);
    expect(await ownsVetProfile(VET_USER, "v1", db)).toBe(true);
    expect(await ownsVetProfile(STRANGER, "v1", db)).toBe(false);
  });

  it("says no for rows that do not exist", async () => {
    expect(await isBookingParticipant(OWNER, "ghost", db)).toBe(false);
    expect(await isAppointmentParticipant(OWNER, "ghost", db)).toBe(false);
    expect(await ownsCaretakerProfile(OWNER, "ghost", db)).toBe(false);
  });
});
