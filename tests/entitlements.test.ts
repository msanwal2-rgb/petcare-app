import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import { getMembership, hasEntitlement, DUNNING_GRACE_DAYS } from "@/lib/server/entitlements";
import { quoteCart } from "@/lib/server/orders";
import { createAppointment } from "@/lib/server/appointments";
import { consultFeeFor } from "@/lib/pricing-vet";
import { shippingFor, amountToFreeShipping, FLAT_SHIPPING_CENTS } from "@/lib/pricing";
import { earliestBookableAt, meetsLeadTime, LEAD_TIME_HOURS } from "@/lib/booking-priority";

/**
 * The seeded members. Chosen so none of them is a user whose order totals other
 * suites assert on — free shipping changes what `quoteCart` returns.
 */
const MEMBER = "u5"; // active
const DUNNING = "u6"; // past_due, inside its grace window
const LAPSED = "u8"; // canceled
const NON_MEMBER = "u2";

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("who counts as a member", () => {
  it("recognises an active subscription", async () => {
    const m = await getMembership(MEMBER, new Date().toISOString(), db);
    expect(m.active).toBe(true);
    expect(m.planKey).toBe("leash_plus");
    expect(m.entitlements).toContain("free_shipping");
    expect(m.consultDiscountPct).toBe(20);
  });

  it("gives no membership to somebody who never had one", async () => {
    const m = await getMembership(NON_MEMBER, new Date().toISOString(), db);
    expect(m.active).toBe(false);
    expect(m.entitlements).toEqual([]);
  });

  it("gives no membership to somebody whose subscription ended", async () => {
    const m = await getMembership(LAPSED, new Date().toISOString(), db);
    expect(m.active).toBe(false);
  });

  it("keeps benefits during dunning, while the retries are still running", async () => {
    // A card expiring should not strip somebody's free shipping mid-order
    // while the provider is still retrying the charge.
    const m = await getMembership(DUNNING, new Date().toISOString(), db);
    expect(m.active).toBe(true);
    expect(m.inGrace).toBe(true);
    expect(m.status).toBe("past_due");
  });

  it("stops benefits once the grace window closes", async () => {
    const sub = await db.subscription.findUnique({ where: { id: "sub_seed_past_due" } });
    const afterGrace = new Date(
      Date.parse(sub!.graceEndsAt!) + 60_000
    ).toISOString();

    const m = await getMembership(DUNNING, afterGrace, db);
    expect(m.active).toBe(false);
  });

  it("stops benefits when the paid-for period has run out", async () => {
    const sub = await db.subscription.findUnique({ where: { id: "sub_seed_active" } });
    const afterPeriod = new Date(
      Date.parse(sub!.currentPeriodEnd) + 60_000
    ).toISOString();

    expect((await getMembership(MEMBER, afterPeriod, db)).active).toBe(false);
  });

  it("keeps benefits to the end of a period somebody has cancelled", async () => {
    await db.subscription.update({
      where: { id: "sub_seed_active" },
      data: { cancelAtPeriodEnd: true },
    });
    const m = await getMembership(MEMBER, new Date().toISOString(), db);
    // They paid for the month; they keep the month.
    expect(m.active).toBe(true);
    expect(m.cancelAtPeriodEnd).toBe(true);
  });

  it("answers a single entitlement question", async () => {
    expect(await hasEntitlement(MEMBER, "free_shipping", undefined, db)).toBe(true);
    expect(await hasEntitlement(NON_MEMBER, "free_shipping", undefined, db)).toBe(false);
  });

  it("has a grace window long enough to be worth having", () => {
    expect(DUNNING_GRACE_DAYS).toBeGreaterThanOrEqual(3);
  });
});

describe("free shipping", () => {
  // Something below the free-shipping threshold, so shipping is charged.
  const smallCart = [{ productId: "prod13", quantity: 1 }];

  it("is waived for a member on a basket that would otherwise pay", async () => {
    const nonMember = await quoteCart(smallCart, { userId: NON_MEMBER }, db);
    const member = await quoteCart(smallCart, { userId: MEMBER }, db);

    expect(nonMember.shippingCents).toBeGreaterThan(0);
    expect(member.shippingCents).toBe(0);
    expect(member.shippingWaivedByMembership).toBe(true);
    expect(member.membershipSavingsCents).toBe(nonMember.shippingCents);
  });

  it("does not claim credit when the basket earned free shipping anyway", async () => {
    const big = [{ productId: "prod13", quantity: 12 }];
    const member = await quoteCart(big, { userId: MEMBER }, db);
    expect(member.shippingCents).toBe(0);
    // The membership didn't do anything here, and shouldn't say it did.
    expect(member.shippingWaivedByMembership).toBe(false);
    expect(member.membershipSavingsCents).toBe(0);
  });

  it("cannot be claimed by a caller who simply says they are a member", async () => {
    // There is no membership field in quoteCartSchema to lie in, and the id
    // comes from the session. Passing an unknown user gets nothing.
    const spoofed = await quoteCart(smallCart, { userId: "ghost" }, db);
    expect(spoofed.shippingCents).toBe(FLAT_SHIPPING_CENTS);
    expect(spoofed.membership.active).toBe(false);
  });

  it("charges an anonymous quote normally", async () => {
    const anon = await quoteCart(smallCart, {}, db);
    expect(anon.shippingCents).toBe(FLAT_SHIPPING_CENTS);
  });

  it("never nags a member to spend more", () => {
    expect(amountToFreeShipping(100, { freeShipping: true })).toBe(0);
    expect(amountToFreeShipping(100)).toBeGreaterThan(0);
  });

  it("is a pure boolean at the arithmetic layer", () => {
    // lib/pricing.ts stays dependency-free; whoever calls it decides.
    expect(shippingFor(100, { freeShipping: true })).toBe(0);
    expect(shippingFor(100)).toBe(FLAT_SHIPPING_CENTS);
  });
});

describe("the vet consultation discount", () => {
  const NOW = new Date("2026-08-01T09:00:00.000Z");
  const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
  const booking = {
    vetId: "v1",
    petId: "p1",
    mode: "in_clinic" as const,
    reason: "Check-up",
    symptoms: [],
    startDateTime: at(48),
    endDateTime: at(48.5),
    notes: "",
  };

  it("does the arithmetic without floating-point crumbs", () => {
    expect(consultFeeFor(89.5, { discountPct: 20 })).toEqual({
      baseFee: 89.5,
      discountPct: 20,
      fee: 71.6,
    });
  });

  it("clamps a nonsense discount", () => {
    expect(consultFeeFor(100, { discountPct: 500 }).fee).toBe(0);
    expect(consultFeeFor(100, { discountPct: -20 }).fee).toBe(100);
  });

  it("snapshots the full fee for a non-member", async () => {
    // p1 belongs to u1, who is not a member.
    const res = await createAppointment("u1", booking, db, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await db.vetAppointment.findUnique({ where: { id: res.appointment.id } });
    expect(row!.discountPct).toBe(0);
    expect(row!.fee).toBe(row!.baseFee);
  });

  it("snapshots the discounted fee for a member", async () => {
    // Give the member a pet to bring in.
    const pet = await db.pet.create({
      data: {
        id: "p_member",
        ownerId: MEMBER,
        name: "Comet",
        species: "dog",
        breed: "Whippet",
        sex: "female",
        dob: "2022-01-01",
        weightLbs: 30,
        photoUrl: "",
        vaccinated: true,
        allergies: [],
        medications: [],
        behaviorNotes: "",
        feedingInstructions: "",
        vetName: "",
        vetPhone: "",
      },
    });

    const res = await createAppointment(MEMBER, { ...booking, petId: pet.id }, db, NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const row = await db.vetAppointment.findUnique({ where: { id: res.appointment.id } });
    expect(row!.discountPct).toBe(20);
    expect(row!.baseFee).toBeGreaterThan(row!.fee);
    expect(row!.fee).toBe(consultFeeFor(row!.baseFee, { discountPct: 20 }).fee);
  });

  it("does not rewrite an existing appointment when a membership changes", async () => {
    const res = await createAppointment("u1", booking, db, NOW);
    if (!res.ok) throw new Error("expected an appointment");
    const before = await db.vetAppointment.findUnique({
      where: { id: res.appointment.id },
    });

    // u1 joins afterwards. History is history.
    await db.subscription.create({
      data: {
        id: "sub_late",
        userId: "u1",
        planId: "plan_leash_plus",
        provider: "demo",
        providerRef: "demo_sub_late",
        status: "active",
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    const after = await db.vetAppointment.findUnique({
      where: { id: res.appointment.id },
    });
    expect(after!.fee).toBe(before!.fee);
    expect(after!.discountPct).toBe(0);
  });
});

describe("priority booking", () => {
  const NOW = new Date("2026-08-01T09:00:00.000Z");
  const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

  it("lets a member ask sooner than everyone else", () => {
    expect(LEAD_TIME_HOURS.member).toBeLessThan(LEAD_TIME_HOURS.standard);
    expect(meetsLeadTime(at(3), NOW, true)).toBe(true);
    expect(meetsLeadTime(at(3), NOW, false)).toBe(false);
  });

  it("refuses a non-member's same-day request", async () => {
    const res = await createAppointment(
      "u1",
      {
        vetId: "v1",
        petId: "p1",
        mode: "in_clinic",
        reason: "Urgent",
        symptoms: [],
        startDateTime: at(3),
        endDateTime: at(3.5),
        notes: "",
      },
      db,
      NOW
    );
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "lead_time") {
      expect(res.isMember).toBe(false);
      expect(res.earliestAt).toBe(earliestBookableAt(NOW, false));
      // The UI offers the upgrade rather than only refusing.
      expect(res.memberEarliestAt).toBe(earliestBookableAt(NOW, true));
    } else {
      throw new Error("expected a lead_time refusal");
    }
  });

  it("marks a member's request as priority", async () => {
    const pet = await db.pet.create({
      data: {
        id: "p_member2",
        ownerId: MEMBER,
        name: "Juno",
        species: "dog",
        breed: "Collie",
        sex: "female",
        dob: "2021-01-01",
        weightLbs: 40,
        photoUrl: "",
        vaccinated: true,
        allergies: [],
        medications: [],
        behaviorNotes: "",
        feedingInstructions: "",
        vetName: "",
        vetPhone: "",
      },
    });

    const res = await createAppointment(
      MEMBER,
      {
        vetId: "v1",
        petId: pet.id,
        mode: "in_clinic",
        reason: "Urgent",
        symptoms: [],
        startDateTime: at(3),
        endDateTime: at(3.5),
        notes: "",
      },
      db,
      NOW
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await db.vetAppointment.findUnique({ where: { id: res.appointment.id } });
    expect(row!.priority).toBe(true);
  });
});
