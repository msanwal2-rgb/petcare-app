/**
 * Seed / reset helpers. Loads the deterministic fixtures in /lib/seed-data into
 * Postgres. Exposed as a function taking a PrismaClient so both the
 * `prisma db seed` script and the test suite's global setup can reuse it.
 */

import type { PrismaClient } from "@prisma/client";
import {
  bookings as seedBookings,
  caretakers as seedCaretakers,
  pets as seedPets,
  reviews as seedReviews,
  users as seedUsers,
} from "@/lib/seed-data";
import {
  appointments as seedAppointments,
  medicalRecords as seedMedicalRecords,
  vetReviews as seedVetReviews,
  vets as seedVets,
  vetUsers as seedVetUsers,
} from "@/lib/seed-data/vets";
import {
  staffUsers as seedStaffUsers,
  orders as seedOrders,
  products as seedProducts,
} from "@/lib/seed-data/store";
import {
  shelterUsers as seedShelterUsers,
  shelters as seedShelters,
  shelterPets as seedShelterPets,
  listings as seedListings,
  applications as seedApplications,
  shelterPetOwnedSince,
} from "@/lib/seed-data/shelters";
import { hashPassword } from "./auth-logic";
import { refreshResponseRate } from "./reputation";
import { DEMO_PASSWORD } from "@/lib/auth/demo";

/** Relative to seed time, so a seeded membership is never already expired. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/** Delete every row, in FK-safe order. */
async function resetDatabase(db: PrismaClient) {
  await db.adoptionApplication.deleteMany();
  await db.adoptionListing.deleteMany();
  await db.shelterProfile.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.subscription.deleteMany();
  await db.plan.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.rateLimitHit.deleteMany();
  await db.orderEvent.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.product.deleteMany();
  await db.medicalRecord.deleteMany();
  await db.vetAppointment.deleteMany();
  await db.vetAvailabilityDay.deleteMany();
  await db.vetProfile.deleteMany();
  await db.message.deleteMany();
  await db.verificationToken.deleteMany();
  await db.review.deleteMany();
  await db.booking.deleteMany();
  await db.availabilityDay.deleteMany();
  await db.pricingEntry.deleteMany();
  await db.caretakerProfile.deleteMany();
  await db.pet.deleteMany();
  await db.adminAuditLog.deleteMany();
  await db.user.deleteMany();
  await db.systemSetting.deleteMany();
}

/** Reset, then insert the full mock dataset. Safe to run repeatedly. */
export async function seedDatabase(db: PrismaClient) {
  await resetDatabase(db);

  // One bcrypt hash of the shared demo password, reused for every seed user
  // (bcrypt.compare still validates it — the salt is embedded in the hash).
  const demoHash = await hashPassword(DEMO_PASSWORD);

  /**
   * Staff do not get the demo password.
   *
   * Every other seeded account shares one password that is printed on the login
   * page and in the README, which is fine for accounts that own a fictional
   * dog. It is not fine for an account that can refund payments and grant
   * itself colleagues — publishing the password to the admin console alongside
   * the console's own address makes the site administrable by anyone who reads
   * the docs.
   *
   * Set STAFF_PASSWORD to something real before seeding anything public.
   */
  const staffPassword = process.env.STAFF_PASSWORD;
  if (!staffPassword) {
    console.warn(
      "\n⚠️  STAFF_PASSWORD is not set — the staff accounts (ops, support,\n" +
        "   finance, admin) will share the public demo password. Fine locally;\n" +
        "   set it to something real before seeding a database anyone can reach.\n"
    );
  }
  const staffHash = staffPassword ? await hashPassword(staffPassword) : demoHash;
  const staffIds = new Set(seedStaffUsers.map((u) => u.id));

  // Owners/caretakers, vets, and the staff accounts all share one table.
  const allUsers = [
    ...seedUsers,
    ...seedVetUsers,
    ...seedStaffUsers,
    ...seedShelterUsers,
  ];
  await db.user.createMany({
    data: allUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      roles: u.roles,
      addressCity: u.address.city,
      addressState: u.address.state,
      lat: u.address.lat,
      lng: u.address.lng,
      verified: u.verified,
      createdAt: u.createdAt,
      passwordHash: staffIds.has(u.id) ? staffHash : demoHash,
      staffRoles: u.staffRoles ?? [],
      // Kept in step with staffRoles until the column is dropped, so a rollback
      // to the previous release finds the fulfilment console still reachable.
      isOps: (u.staffRoles ?? []).some((r) => r === "ops" || r === "admin"),
    })),
  });

  await db.pet.createMany({
    data: [...seedPets, ...seedShelterPets].map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      // The epoch, matching the migration's backfill: these ownerships predate
      // the column, and every seeded booking and appointment carries a fixed
      // 2025–26 date. Set to seed time instead, every non-owner grant in the
      // demo would evaporate — the treating vet would lose the patient record
      // they are supposed to be writing.
      // Epoch for the pets that predate the column, so their existing bookings
      // and appointments still grant access. Shelter animals are new, so they
      // get the date the shelter actually took them in.
      ownedSince: shelterPetOwnedSince[p.id] ?? "1970-01-01T00:00:00.000Z",
      name: p.name,
      species: p.species,
      breed: p.breed,
      sex: p.sex,
      dob: p.dob,
      weightLbs: p.weightLbs,
      photoUrl: p.photoUrl,
      vaccinated: p.vaccinated,
      allergies: p.allergies,
      medications: p.medications,
      behaviorNotes: p.behaviorNotes,
      feedingInstructions: p.feedingInstructions,
      vetName: p.vetContact.name,
      vetPhone: p.vetContact.phone,
    })),
  });

  for (const c of seedCaretakers) {
    await db.caretakerProfile.create({
      data: {
        id: c.id,
        userId: c.userId,
        bio: c.bio,
        servicesOffered: c.servicesOffered,
        serviceRadiusMiles: c.serviceRadiusMiles,
        acceptedSpecies: c.acceptedSpecies,
        fencedYard: c.homeEnvironment.fencedYard,
        hasOtherPets: c.homeEnvironment.hasOtherPets,
        smokeFree: c.homeEnvironment.smokeFree,
        certifications: c.certifications,
        backgroundCheckStatus: c.backgroundCheckStatus,
        rating: c.rating,
        reviewCount: c.reviewCount,
        responseRatePct: c.responseRatePct,
        pricing: {
          create: c.pricing.map((p) => ({
            serviceType: p.serviceType,
            unit: p.unit,
            rate: p.rate,
          })),
        },
        availability: {
          create: c.availability.map((d) => ({
            date: d.date,
            slots: d.slots,
          })),
        },
      },
    });
  }

  await db.booking.createMany({
    data: seedBookings.map((b) => ({
      id: b.id,
      ownerId: b.ownerId,
      caretakerId: b.caretakerId,
      petIds: b.petIds,
      serviceType: b.serviceType,
      startDateTime: b.startDateTime,
      endDateTime: b.endDateTime,
      notes: b.notes,
      status: b.status,
      priceTotal: b.priceTotal,
      createdAt: b.createdAt,
    })),
  });

  await db.review.createMany({
    data: seedReviews.map((r) => ({
      id: r.id,
      bookingId: r.subjectId,
      kind: r.kind,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  });

  // A little chat history on the two in-progress bookings so the thread isn't
  // empty in the demo. b7: owner u1 ↔ caretaker u8; b8: owner u14 ↔ caretaker u11.
  await db.message.createMany({
    data: [
      { id: "msg1", bookingId: "b7", fromUserId: "u1", body: "Hi! Miso can be shy at first — thanks for taking such good care of her.", createdAt: "2026-07-06T12:30:00Z", readAt: "2026-07-06T12:45:00Z" },
      { id: "msg2", bookingId: "b7", fromUserId: "u8", body: "Of course! She's already found the sunny spot by the window 🐱", createdAt: "2026-07-06T13:05:00Z", readAt: "2026-07-06T13:20:00Z" },
      { id: "msg3", bookingId: "b7", fromUserId: "u1", body: "That's her favorite. You're the best!", createdAt: "2026-07-06T13:22:00Z", readAt: null },
      { id: "msg4", bookingId: "b8", fromUserId: "u14", body: "Duke's had breakfast — no beef, all good. He loves the yard!", createdAt: "2026-07-07T09:30:00Z", readAt: "2026-07-07T10:00:00Z" },
      { id: "msg5", bookingId: "b8", fromUserId: "u11", body: "He's a champ. We did a long fetch session this morning 🎾", createdAt: "2026-07-07T11:15:00Z", readAt: null },
    ],
  });

  /* ── Vet care ─────────────────────────────────────────────────────── */

  for (const v of seedVets) {
    await db.vetProfile.create({
      data: {
        id: v.id,
        userId: v.userId,
        clinicName: v.clinicName,
        bio: v.bio,
        specialties: v.specialties,
        licenseNumber: v.licenseNumber,
        licenseState: v.licenseState,
        // The seeded vets are the demo's licensed professionals, so the
        // directory doesn't read as entirely unverified on a fresh database.
        verificationStatus: v.verificationStatus ?? "verified",
        yearsExperience: v.yearsExperience,
        acceptedSpecies: v.acceptedSpecies,
        consultModes: v.consultModes,
        consultFee: v.consultFee,
        emergencyAvailable: v.emergencyAvailable,
        clinicCity: v.clinic.city,
        clinicState: v.clinic.state,
        lat: v.clinic.lat,
        lng: v.clinic.lng,
        rating: v.rating,
        reviewCount: v.reviewCount,
        responseRatePct: v.responseRatePct,
        availability: {
          create: v.availability.map((d) => ({ date: d.date, slots: d.slots })),
        },
      },
    });
  }

  await db.vetAppointment.createMany({ data: seedAppointments });
  await db.medicalRecord.createMany({ data: seedMedicalRecords });
  await db.review.createMany({
    data: seedVetReviews.map((r) => ({
      id: r.id,
      bookingId: r.subjectId,
      kind: r.kind,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  });

  /* ── Store ────────────────────────────────────────────────────────── */

  await db.product.createMany({ data: seedProducts });

  for (const o of seedOrders) {
    const { items, events, ...order } = o;
    await db.order.create({
      data: {
        ...order,
        items: { create: items },
        events: { create: events },
      },
    });

    // A ledger row for each seeded order.
    //
    // Seeded orders carry `paymentRef` and `paymentStatus` because they predate
    // the ledger, and without a matching Payment row a refund from the admin
    // console would find nothing to refund. Reconstructed rather than
    // hand-authored so the two can't disagree.
    if (order.paymentRef) {
      await db.payment.create({
        data: {
          id: `pay_seed_${order.id}`,
          userId: order.userId,
          kind: "order",
          orderId: order.id,
          provider: "demo",
          providerRef: order.paymentRef,
          status: order.paymentStatus ?? "paid",
          amountCents: order.totalCents,
          amountRefundedCents:
            order.paymentStatus === "refunded" ? order.totalCents : 0,
          currency: "usd",
          methodBrand: "demo",
          methodLast4: "0000",
          createdAt: order.placedAt,
          updatedAt: order.placedAt,
          succeededAt: order.paymentStatus === "paid" ? order.placedAt : null,
        },
      });
    }
  }

  /* ── Membership ───────────────────────────────────────────────────── */

  // The plan itself is inserted by migration 9 rather than seeded, because it
  // is configuration the production database needs whether or not it was ever
  // seeded. Re-asserted here so a `db push` test schema, which runs no
  // migrations, has one too.
  const plan = await db.plan.upsert({
    where: { id: "plan_leash_plus" },
    update: {},
    create: {
      id: "plan_leash_plus",
      key: "leash_plus",
      name: "Leash Plus",
      description:
        "Free delivery on everything, 20% off every vet consultation, and same-day booking.",
      priceCents: 999,
      currency: "usd",
      interval: "month",
      entitlements: ["free_shipping", "vet_consult_discount", "priority_booking"],
      consultDiscountPct: 20,
      active: true,
      createdAt: "2026-09-09T00:00:00.000Z",
    },
  });

  // Three subscribers, one per state worth being able to demonstrate: a member
  // in good standing, one whose card just failed, and one who has left.
  //
  // ⚠️ Deliberately NOT u1 (Maya) or any account whose order totals the test
  // suite asserts on — free shipping changes what `quoteCart` returns, and
  // tests/orders.test.ts checks exact cents for u1.
  await db.subscription.createMany({
    data: [
      {
        id: "sub_seed_active",
        userId: "u5",
        planId: plan.id,
        provider: "demo",
        providerRef: "demo_sub_active",
        status: "active",
        currentPeriodStart: daysFromNow(-4),
        currentPeriodEnd: daysFromNow(26),
        createdAt: daysFromNow(-64),
        updatedAt: daysFromNow(-4),
      },
      {
        id: "sub_seed_past_due",
        userId: "u6",
        planId: plan.id,
        provider: "demo",
        providerRef: "demo_sub_past_due",
        status: "past_due",
        currentPeriodStart: daysFromNow(-2),
        currentPeriodEnd: daysFromNow(28),
        graceEndsAt: daysFromNow(5),
        createdAt: daysFromNow(-92),
        updatedAt: daysFromNow(-2),
      },
      {
        id: "sub_seed_canceled",
        userId: "u8",
        planId: plan.id,
        provider: "demo",
        providerRef: "demo_sub_canceled",
        status: "canceled",
        currentPeriodStart: daysFromNow(-40),
        currentPeriodEnd: daysFromNow(-10),
        canceledAt: daysFromNow(-12),
        endedAt: daysFromNow(-10),
        createdAt: daysFromNow(-130),
        updatedAt: daysFromNow(-10),
      },
    ],
  });

  /* ── Adoption ─────────────────────────────────────────────────────── */

  await db.shelterProfile.createMany({ data: seedShelters });
  await db.adoptionListing.createMany({ data: seedListings });
  await db.adoptionApplication.createMany({ data: seedApplications });

  // responseRatePct is derived, so the fixtures must not get to hand-author it
  // either — otherwise the seeded number contradicts the real one the moment
  // anybody accepts a request.
  for (const c of seedCaretakers) await refreshResponseRate("caretaker", c.id, db);
  for (const v of seedVets) await refreshResponseRate("vet", v.id, db);
  for (const sh of seedShelters) await refreshResponseRate("shelter", sh.id, db);

  return {
    users: allUsers.length,
    pets: seedPets.length,
    caretakers: seedCaretakers.length,
    bookings: seedBookings.length,
    reviews: seedReviews.length + seedVetReviews.length,
    messages: 5,
    vets: seedVets.length,
    appointments: seedAppointments.length,
    medicalRecords: seedMedicalRecords.length,
    products: seedProducts.length,
    shelters: seedShelters.length,
    listings: seedListings.length,
    applications: seedApplications.length,
    orders: seedOrders.length,
  };
}
