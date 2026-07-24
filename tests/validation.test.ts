import { describe, expect, it } from "vitest";
import {
  createBookingSchema,
  createReviewSchema,
  createUserSchema,
  searchQuerySchema,
  updateBookingStatusSchema,
} from "@/lib/validation/schemas";

describe("validation schemas", () => {
  it("accepts a valid user payload", () => {
    expect(
      createUserSchema.safeParse({ name: "A", email: "a@b.com" }).success
    ).toBe(true);
  });

  it("rejects a bad email and empty name", () => {
    expect(createUserSchema.safeParse({ name: "A", email: "nope" }).success).toBe(
      false
    );
    expect(
      createUserSchema.safeParse({ name: "", email: "a@b.com" }).success
    ).toBe(false);
  });

  it("coerces numeric search params from strings", () => {
    const parsed = searchQuerySchema.parse({
      lat: "30.2",
      lng: "-97.7",
      radiusMiles: "10",
    });
    expect(parsed.lat).toBeCloseTo(30.2);
    expect(parsed.radiusMiles).toBe(10);
  });

  it("rejects an invalid service type in search", () => {
    expect(
      searchQuerySchema.safeParse({ serviceType: "grooming" }).success
    ).toBe(false);
  });

  it("rejects an invalid booking status", () => {
    expect(
      updateBookingStatusSchema.safeParse({ status: "paused" }).success
    ).toBe(false);
  });

  it("requires at least one pet on a booking", () => {
    expect(
      createBookingSchema.safeParse({
        ownerId: "u1",
        caretakerId: "c1",
        petIds: [],
        serviceType: "walking",
        startDateTime: "x",
        endDateTime: "y",
        notes: "",
        priceTotal: 10,
      }).success
    ).toBe(false);
  });

  it("bounds review rating to 0–5", () => {
    expect(
      createReviewSchema.safeParse({
        fromUserId: "u1",
        toUserId: "u2",
        rating: 9,
        comment: "x",
      }).success
    ).toBe(false);
  });
});
