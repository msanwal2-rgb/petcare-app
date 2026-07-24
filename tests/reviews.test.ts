import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  createReview,
  getReviewsForBooking,
  getReviewsForUser,
} from "@/lib/server/reviews";

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("reviews", () => {
  it("returns reviews written about a user, newest first", async () => {
    const reviews = await getReviewsForUser("u14", db);
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews.every((r) => r.toUserId === "u14")).toBe(true);
    for (let i = 1; i < reviews.length; i++) {
      expect(reviews[i - 1].createdAt >= reviews[i].createdAt).toBe(true);
    }
  });

  it("returns [] for a user with no reviews", async () => {
    expect(await getReviewsForUser("u5", db)).toEqual([]);
  });

  it("returns both reviews attached to a booking", async () => {
    const reviews = await getReviewsForBooking("b9", db);
    expect(reviews.length).toBe(2);
  });

  it("creates a review under a booking", async () => {
    const created = await createReview(
      "b10",
      {
        fromUserId: "u10",
        toUserId: "u3",
        rating: 5,
        comment: "Lovely puppy and clear instructions.",
      },
      db
    );
    expect(created.id).toMatch(/^r_/);
    expect(created.bookingId).toBe("b10");
    const forBooking = await getReviewsForBooking("b10", db);
    expect(forBooking.some((r) => r.id === created.id)).toBe(true);
    // and it shows up under the reviewee
    const forUser = await getReviewsForUser("u3", db);
    expect(forUser.some((r) => r.id === created.id)).toBe(true);
  });
});
