import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import { completeAdoption, reverseAdoption } from "@/lib/server/adoptions/transfer";
import { updateApplicationStatus } from "@/lib/server/adoptions/applications";
import { canAccessPetRecords, canViewPet, ownsPet } from "@/lib/server/access";
import { authorizedProductSlugs } from "@/lib/server/medical-records";
import { nowIso } from "@/lib/server/ids";

/**
 * Completing an adoption.
 *
 * The seeded state this leans on:
 *   aa3 — approved application, u4 adopting Juniper (p15) from sh2 (user u25)
 *   al3 — her listing, currently `pending` because she is approved
 *   fee — $150, unpaid
 */
const APPLICATION = "aa3";
const LISTING = "al3";
const PET = "p15";
const SHELTER_USER = "u25";
const ADOPTER = "u4";

async function payTheFee() {
  const app = await db.adoptionApplication.findUnique({
    where: { id: APPLICATION },
  });
  await db.payment.create({
    data: {
      id: "pay_adoption_test",
      userId: ADOPTER,
      kind: "adoption_fee",
      adoptionApplicationId: APPLICATION,
      provider: "demo",
      providerRef: "demo_pi_adoption_test",
      status: "paid",
      amountCents: app!.feeCents,
      currency: "usd",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      succeededAt: nowIso(),
    },
  });
}

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("preconditions", () => {
  it("refuses anyone but the shelter", async () => {
    await payTheFee();
    // The applicant pays; the shelter hands over. Splitting them keeps each
    // action with the party who performs it in the world.
    expect(await completeAdoption(APPLICATION, ADOPTER, {}, db)).toEqual({
      ok: false,
      code: "not_allowed",
    });
  });

  it("refuses an application that is not approved", async () => {
    const res = await completeAdoption("aa1", "u24", {}, db);
    expect(res).toMatchObject({ ok: false, code: "invalid_transition" });
  });

  it("refuses while the fee is unpaid", async () => {
    const res = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(res).toMatchObject({ ok: false, code: "fee_unpaid" });
    // And nothing moved.
    expect(await ownsPet(SHELTER_USER, PET, db)).toBe(true);
  });

  it("completes a waived fee with no payment at all", async () => {
    await db.adoptionApplication.update({
      where: { id: APPLICATION },
      data: { feeCents: 0 },
    });
    const res = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(res.ok).toBe(true);
    // Plenty of shelters waive fees; a $0 payment intent would have been
    // rejected by the provider anyway.
    const payment = await db.payment.findUnique({
      where: { adoptionApplicationId: APPLICATION },
    });
    expect(payment).toBeNull();
  });

  it("reports an unknown application rather than throwing", async () => {
    expect(await completeAdoption("ghost", SHELTER_USER, {}, db)).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("live engagements", () => {
  it("refuses while a booking is open, and names it", async () => {
    await payTheFee();
    await db.booking.create({
      data: {
        id: "b_foster",
        ownerId: SHELTER_USER,
        caretakerId: "c1",
        petIds: [PET],
        serviceType: "boarding",
        startDateTime: new Date(Date.now() - 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        notes: "In foster",
        status: "in_progress",
        priceTotal: 400,
        createdAt: nowIso(),
      },
    });

    const res = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(res).toMatchObject({ ok: false, code: "live_engagements" });
    if (!res.ok && res.code === "live_engagements") {
      // The ids come back so the UI can say what is in the way rather than
      // refusing and leaving the shelter to guess.
      expect(res.bookingIds).toContain("b_foster");
    }
    expect(await ownsPet(SHELTER_USER, PET, db)).toBe(true);
  });

  it("goes through when the shelter explicitly forces it, cancelling as it goes", async () => {
    await payTheFee();
    await db.booking.create({
      data: {
        id: "b_foster",
        ownerId: SHELTER_USER,
        caretakerId: "c1",
        petIds: [PET],
        serviceType: "boarding",
        startDateTime: new Date(Date.now() - 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 6 * 86_400_000).toISOString(),
        notes: "In foster",
        status: "in_progress",
        priceTotal: 400,
        createdAt: nowIso(),
      },
    });

    const res = await completeAdoption(APPLICATION, SHELTER_USER, { force: true }, db);
    expect(res.ok).toBe(true);

    // Cancelled through the booking's own machine, so the caretaker gets the
    // event and the notification a silent UPDATE would have skipped.
    const booking = await db.booking.findUnique({ where: { id: "b_foster" } });
    expect(booking!.status).toBe("cancelled");
  });

  it("refuses while a vet appointment is open", async () => {
    await payTheFee();
    await db.vetAppointment.create({
      data: {
        id: "a_midtreatment",
        ownerId: SHELTER_USER,
        vetId: "v1",
        petId: PET,
        mode: "in_clinic",
        reason: "Dental",
        symptoms: [],
        startDateTime: new Date(Date.now() + 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 90_000_000).toISOString(),
        status: "confirmed",
        baseFee: 90,
        fee: 90,
        createdAt: nowIso(),
      },
    });

    const res = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(res).toMatchObject({ ok: false, code: "live_engagements" });
    if (!res.ok && res.code === "live_engagements") {
      expect(res.appointmentIds).toContain("a_midtreatment");
    }
  });
});

describe("the transfer itself", () => {
  beforeEach(payTheFee);

  it("moves the animal and closes everything around it", async () => {
    const res = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(res.ok).toBe(true);

    expect(await ownsPet(ADOPTER, PET, db)).toBe(true);
    expect(await ownsPet(SHELTER_USER, PET, db)).toBe(false);

    const listing = await db.adoptionListing.findUnique({ where: { id: LISTING } });
    expect(listing!.status).toBe("adopted");
    expect(listing!.closedAt).not.toBeNull();

    const application = await db.adoptionApplication.findUnique({
      where: { id: APPLICATION },
    });
    expect(application!.status).toBe("completed");
    expect(application!.completedAt).not.toBeNull();
  });

  it("takes the health record with the animal", async () => {
    const before = await db.medicalRecord.count({ where: { petId: PET } });
    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    const after = await db.medicalRecord.count({ where: { petId: PET } });

    // The records do not move — they are keyed on the pet, so they follow it by
    // standing still. That is the whole reason a shelter animal is a Pet row.
    expect(after).toBe(before);
    expect((await canAccessPetRecords(ADOPTER, PET, db)).allowed).toBe(true);
  });

  it("severs the shelter's vets and caretakers", async () => {
    // Give the shelter an engagement that would otherwise outlive the adoption.
    //
    // Note the `createdAt`: it has to fall *after* the shelter's own
    // `ownedSince`, or the grant never existed in the first place. Seeded
    // shelter animals carry their real intake date, so an appointment dated
    // before the shelter had the animal grants nothing — which is the same rule
    // working one step further back, and is asserted below.
    await db.vetAppointment.create({
      data: {
        id: "a_shelter_history",
        ownerId: SHELTER_USER,
        vetId: "v1",
        petId: PET,
        mode: "in_clinic",
        reason: "Intake exam",
        symptoms: [],
        startDateTime: new Date(Date.now() - 5 * 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() - 5 * 86_400_000 + 1_800_000).toISOString(),
        status: "completed",
        baseFee: 90,
        fee: 90,
        createdAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      },
    });
    const vet = await db.vetProfile.findUnique({ where: { id: "v1" } });
    expect((await canAccessPetRecords(vet!.userId, PET, db)).allowed).toBe(true);

    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);

    // Without this the shelter's vet would keep writing prescriptions against
    // the adopter's animal — and so against the adopter's store account.
    expect((await canAccessPetRecords(vet!.userId, PET, db)).allowed).toBe(false);
    expect(await canViewPet(SHELTER_USER, PET, db)).toBe(false);
  });

  it("grants nothing for an engagement older than the shelter's own ownership", async () => {
    // The same rule, one step further back. An appointment dated before the
    // shelter took the animal in describes somebody else's household, and it
    // should not reach into this one either.
    const pet = await db.pet.findUnique({ where: { id: PET } });
    const beforeIntake = new Date(
      Date.parse(pet!.ownedSince) - 86_400_000
    ).toISOString();

    await db.vetAppointment.create({
      data: {
        id: "a_previous_household",
        ownerId: "u1",
        vetId: "v1",
        petId: PET,
        mode: "in_clinic",
        reason: "Before the shelter had her",
        symptoms: [],
        startDateTime: beforeIntake,
        endDateTime: beforeIntake,
        status: "completed",
        baseFee: 90,
        fee: 90,
        createdAt: beforeIntake,
      },
    });

    const vet = await db.vetProfile.findUnique({ where: { id: "v1" } });
    expect((await canAccessPetRecords(vet!.userId, PET, db)).allowed).toBe(false);
  });

  it("does not hand the adopter a prescription pipeline they didn't earn", async () => {
    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);

    const vet = await db.vetProfile.findUnique({ where: { id: "v1" } });
    const before = await authorizedProductSlugs(PET, undefined, db);

    // The shelter's vet tries to write a new prescription after the handover.
    const access = await canAccessPetRecords(vet!.userId, PET, db);
    expect(access.allowed).toBe(false);

    const after = await authorizedProductSlugs(PET, undefined, db);
    expect([...after]).toEqual([...before]);
  });

  it("closes the other applications for the same animal", async () => {
    // A second person wanting the same dog.
    await db.adoptionApplication.create({
      data: {
        id: "aa_rival",
        listingId: LISTING,
        shelterId: "sh2",
        petId: PET,
        petName: "Juniper",
        petPhotoUrl: "",
        applicantId: "u6",
        status: "submitted",
        feeCents: 15000,
        homeType: "house",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
    });

    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);

    const rival = await db.adoptionApplication.findUnique({
      where: { id: "aa_rival" },
    });
    // Told, rather than left refreshing a listing that will never come back.
    expect(rival!.status).toBe("rejected");
    expect(rival!.decisionNote).toContain("Juniper");
  });

  it("tells the adopter", async () => {
    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    const notice = await db.notification.findFirst({
      where: { userId: ADOPTER, kind: "adoption_completed" },
    });
    expect(notice).not.toBeNull();
    expect(notice!.href).toBe(`/dashboard/pets/${PET}`);
  });

  it("lets exactly one of two concurrent completions win", async () => {
    // Phase 0 runs outside the transaction, so both callers can pass it. The
    // conditional updateMany is what makes only one of them commit.
    const [a, b] = await Promise.all([
      completeAdoption(APPLICATION, SHELTER_USER, {}, db),
      completeAdoption(APPLICATION, SHELTER_USER, {}, db),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
  });

  it("refuses a second completion afterwards", async () => {
    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    const again = await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
    expect(again).toMatchObject({ ok: false });
  });
});

describe("putting an animal back", () => {
  beforeEach(async () => {
    await payTheFee();
    await completeAdoption(APPLICATION, SHELTER_USER, {}, db);
  });

  it("returns ownership and reopens the listing", async () => {
    const res = await reverseAdoption(APPLICATION, "Allergic reaction", db);
    expect(res.ok).toBe(true);

    expect(await ownsPet(SHELTER_USER, PET, db)).toBe(true);
    const listing = await db.adoptionListing.findUnique({ where: { id: LISTING } });
    expect(listing!.status).toBe("available");
    expect(listing!.closedAt).toBeNull();
  });

  it("severs the adopter's own vets on the way back", async () => {
    // The adopter books their own vet after adopting...
    await db.vetAppointment.create({
      data: {
        id: "a_adopter_vet",
        ownerId: ADOPTER,
        vetId: "v2",
        petId: PET,
        mode: "in_clinic",
        reason: "First check-up",
        symptoms: [],
        startDateTime: new Date(Date.now() + 86_400_000).toISOString(),
        endDateTime: new Date(Date.now() + 90_000_000).toISOString(),
        status: "confirmed",
        baseFee: 140,
        fee: 140,
        createdAt: nowIso(),
      },
    });
    const v2 = await db.vetProfile.findUnique({ where: { id: "v2" } });
    expect((await canAccessPetRecords(v2!.userId, PET, db)).allowed).toBe(true);

    await reverseAdoption(APPLICATION, "Returned", db);

    // The mechanism has never cared which way an animal moves.
    expect((await canAccessPetRecords(v2!.userId, PET, db)).allowed).toBe(false);
  });

  it("refuses to reverse something that never completed", async () => {
    const res = await reverseAdoption("aa1", "Nope", db);
    expect(res).toMatchObject({ ok: false, code: "not_completed" });
  });
});

describe("post-approval refunds", () => {
  it("gives the money back when an approved applicant is rejected", async () => {
    await payTheFee();
    const res = await updateApplicationStatus(
      APPLICATION,
      "rejected",
      "shelter",
      "Home check raised concerns",
      db
    );
    expect(res.ok).toBe(true);

    // Somebody approved to adopt and then told no must not also be out of
    // pocket. There is no version of "we'll sort it out by email" here.
    const payment = await db.payment.findUnique({
      where: { adoptionApplicationId: APPLICATION },
    });
    expect(payment!.status).toBe("refunded");

    // And the animal goes back on the market.
    const listing = await db.adoptionListing.findUnique({ where: { id: LISTING } });
    expect(listing!.status).toBe("available");
  });
});
