/**
 * Seed / reset helpers. Ports the deterministic mock data in /lib/mock-data
 * into Postgres. Exposed as functions (taking a PrismaClient) so both the
 * `prisma db seed` script and the test suite can reuse them.
 */

import type { PrismaClient } from "@prisma/client";
import {
  bookings as seedBookings,
  caretakers as seedCaretakers,
  pets as seedPets,
  reviews as seedReviews,
  users as seedUsers,
} from "@/lib/mock-data";
import { hashPassword } from "./auth-logic";
import { DEMO_PASSWORD } from "@/lib/auth/demo";

/** Delete every row, in FK-safe order. */
export async function resetDatabase(db: PrismaClient) {
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

  await db.user.createMany({
    data: seedUsers.map((u) => ({
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

  return {
    users: seedUsers.length,
    pets: seedPets.length,
    caretakers: seedCaretakers.length,
    bookings: seedBookings.length,
    reviews: seedReviews.length,
  };
}
