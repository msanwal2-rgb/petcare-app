import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  createReview,
  getReviewsForSubject,
  getReviewsForUser,
} from "@/lib/server/reviews";

/* Seed shape this file leans on:
 *   b10 — completed booking, owner u3, caretaker c4 (= user u10); the seed
 *         already carries u3's review of it, so tests that need that
 *         direction free clear it first
 *   b11 — completed booking, owner u6, caretaker c9 (= user u15); only the
 *         owner's direction is used in the seed
 *   b1  — a *requested* booking, owner u1, caretaker c1
 *   a1  — completed appointment, owner u3, vet v1 (= user u17), reviewed by u3
 *   a3  — a *confirmed* appointment, owner u1, vet v1
 *   a5  — completed appointment, owner u14, vet v3 (= user u19), reviewed
 */

const good = { rating: 5, comment: "Clear, kind and on time." };

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("reading reviews", () => {
  it("returns reviews about a user, newest first", async () => {
    const reviews = await getReviewsForUser("u14", undefined, db);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((r) => r.toUserId === "u14")).toBe(true);
    for (let i = 1; i < reviews.length; i++) {
      expect(reviews[i - 1].createdAt >= reviews[i].createdAt).toBe(true);
    }
  });

  it("returns [] for a user nobody has reviewed", async () => {
    expect(await getReviewsForUser("u5", undefined, db)).toEqual([]);
  });

  it("returns both reviews attached to a booking", async () => {
    expect((await getReviewsForSubject("b9", db)).length).toBe(2);
  });

  it("separates a vet's reviews from a caretaker's", async () => {
    const vetOnly = await getReviewsForUser("u17", "vet_appointment", db);
    expect(vetOnly.length).toBeGreaterThan(0);
    expect(vetOnly.every((r) => r.kind === "vet_appointment")).toBe(true);
    expect(await getReviewsForUser("u17", "booking", db)).toEqual([]);
  });

  it("reports the subject it belongs to", async () => {
    const [review] = await getReviewsForSubject("a1", db);
    expect(review.subjectId).toBe("a1");
    expect(review.kind).toBe("vet_appointment");
  });
});

describe("reviewing a booking", () => {
  it("accepts a review from the owner about the caretaker", async () => {
    await db.review.deleteMany({ where: { bookingId: "b10", fromUserId: "u3" } });
    const res = await createReview("b10", "booking", { fromUserId: "u3", toUserId: "u10", ...good }, db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.id).toMatch(/^r_/);
    expect(res.review.subjectId).toBe("b10");
    expect(res.review.kind).toBe("booking");
    expect((await getReviewsForUser("u10", undefined, db)).some((r) => r.id === res.review.id)).toBe(true);
  });

  it("accepts the caretaker reviewing the owner back", async () => {
    const res = await createReview("b10", "booking", { fromUserId: "u10", toUserId: "u3", ...good }, db);
    expect(res.ok).toBe(true);
  });

  it("refuses someone who had nothing to do with it", async () => {
    const res = await createReview("b10", "booking", { fromUserId: "u1", toUserId: "u10", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_a_participant");
  });

  it("refuses a review aimed at someone outside the booking", async () => {
    const res = await createReview("b10", "booking", { fromUserId: "u3", toUserId: "u1", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("wrong_recipient");
  });

  it("refuses a booking that hasn't happened yet", async () => {
    const res = await createReview("b1", "booking", { fromUserId: "u1", toUserId: "u4", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_completed");
  });

  it("refuses an unknown booking", async () => {
    const res = await createReview("ghost", "booking", { fromUserId: "u3", toUserId: "u10", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });

  it("allows one review per person, not two", async () => {
    await db.review.deleteMany({ where: { bookingId: "b10", fromUserId: "u3" } });
    expect((await createReview("b10", "booking", { fromUserId: "u3", toUserId: "u10", ...good }, db)).ok).toBe(true);
    const second = await createReview("b10", "booking", { fromUserId: "u3", toUserId: "u10", rating: 1, comment: "Changed my mind." }, db);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("already_reviewed");
  });
});

describe("reviewing a vet appointment", () => {
  it("accepts a review from the pet's owner about the vet", async () => {
    // a3 is confirmed; complete it first so it can be reviewed.
    await db.vetAppointment.update({ where: { id: "a3" }, data: { status: "completed" } });
    const res = await createReview("a3", "vet_appointment", { fromUserId: "u1", toUserId: "u17", ...good }, db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.review.kind).toBe("vet_appointment");
  });

  it("refuses the vet reviewing the client back — it is one-directional", async () => {
    await db.vetAppointment.update({ where: { id: "a3" }, data: { status: "completed" } });
    const res = await createReview("a3", "vet_appointment", { fromUserId: "u17", toUserId: "u1", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_a_participant");
  });

  it("refuses a visit that hasn't happened yet", async () => {
    const res = await createReview("a3", "vet_appointment", { fromUserId: "u1", toUserId: "u17", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_completed");
  });

  it("refuses a second review of the same visit", async () => {
    // u3 already reviewed a1 in the seed data.
    const res = await createReview("a1", "vet_appointment", { fromUserId: "u3", toUserId: "u17", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("already_reviewed");
  });

  it("refuses an unrelated owner", async () => {
    const res = await createReview("a1", "vet_appointment", { fromUserId: "u1", toUserId: "u17", ...good }, db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_a_participant");
  });
});

describe("the reviewee's headline rating", () => {
  it("folds a vet review into the profile as a running average", async () => {
    const before = await db.vetProfile.findUnique({ where: { id: "v1" } });
    await db.vetAppointment.update({ where: { id: "a3" }, data: { status: "completed" } });
    await createReview("a3", "vet_appointment", { fromUserId: "u1", toUserId: "u17", rating: 4, comment: "Good." }, db);

    const after = await db.vetProfile.findUnique({ where: { id: "v1" } });
    expect(after!.reviewCount).toBe(before!.reviewCount + 1);
    // Stored unrounded — see applyRating: rounding the accumulator would let a
    // profile with a long history absorb bad reviews forever without moving.
    const expected = (before!.rating * before!.reviewCount + 4) / (before!.reviewCount + 1);
    expect(after!.rating).toBeCloseTo(expected, 10);
    // A single 4 must not wipe out a long history of 4.9s.
    expect(after!.rating).toBeGreaterThan(4.5);
  });

  it("folds a caretaker review into their profile too", async () => {
    await db.review.deleteMany({ where: { bookingId: "b10", fromUserId: "u3" } });
    const before = await db.caretakerProfile.findUnique({ where: { id: "c4" } });
    await createReview("b10", "booking", { fromUserId: "u3", toUserId: "u10", rating: 5, comment: "Great." }, db);
    const after = await db.caretakerProfile.findUnique({ where: { id: "c4" } });
    expect(after!.reviewCount).toBe(before!.reviewCount + 1);
  });

  it("leaves ratings alone when the reviewee is an owner with no profile", async () => {
    const res = await createReview("b11", "booking", { fromUserId: "u15", toUserId: "u6", ...good }, db);
    expect(res.ok).toBe(true); // u6 has no caretaker or vet profile to update
  });

  it("does not move a rating when the review was refused", async () => {
    const before = await db.vetProfile.findUnique({ where: { id: "v1" } });
    await createReview("a3", "vet_appointment", { fromUserId: "u1", toUserId: "u17", ...good }, db);
    const after = await db.vetProfile.findUnique({ where: { id: "v1" } });
    expect(after!.reviewCount).toBe(before!.reviewCount);
    expect(after!.rating).toBe(before!.rating);
  });
});
