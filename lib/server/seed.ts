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
  vets as seedVets,
  vetUsers as seedVetUsers,
} from "@/lib/seed-data/vets";
import {
  opsUser as seedOpsUser,
  orders as seedOrders,
  products as seedProducts,
} from "@/lib/seed-data/store";
import { hashPassword } from "./auth-logic";
import { DEMO_PASSWORD } from "@/lib/auth/demo";

/** Delete every row, in FK-safe order. */
async function resetDatabase(db: PrismaClient) {
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
  await db.user.deleteMany();
}

/** Reset, then insert the full mock dataset. Safe to run repeatedly. */
export async function seedDatabase(db: PrismaClient) {
  await resetDatabase(db);

  // One bcrypt hash of the shared demo password, reused for every seed user
  // (bcrypt.compare still validates it — the salt is embedded in the hash).
  const demoHash = await hashPassword(DEMO_PASSWORD);

  // Owners/caretakers, vets, and the store's ops account all share one table.
  const allUsers = [...seedUsers, ...seedVetUsers, seedOpsUser];
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
      passwordHash: demoHash,
      isOps: u.id === seedOpsUser.id,
    })),
  });

  await db.pet.createMany({
    data: seedPets.map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
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
      bookingId: r.bookingId,
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
  }

  return {
    users: allUsers.length,
    pets: seedPets.length,
    caretakers: seedCaretakers.length,
    bookings: seedBookings.length,
    reviews: seedReviews.length,
    messages: 5,
    vets: seedVets.length,
    appointments: seedAppointments.length,
    medicalRecords: seedMedicalRecords.length,
    products: seedProducts.length,
    orders: seedOrders.length,
  };
}
