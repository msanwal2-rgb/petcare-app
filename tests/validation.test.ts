import { describe, expect, it } from "vitest";
import {
  createBookingSchema,
  createReviewSchema,
  searchQuerySchema,
  updateBookingStatusSchema,
  updateUserSchema,
} from "@/lib/validation/schemas";

describe("validation schemas", () => {
  it("accepts a valid user patch", () => {
    expect(updateUserSchema.safeParse({ name: "A", phone: "555" }).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(updateUserSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("ignores an email rather than validating one", () => {
    // Stronger than rejecting a *bad* address: the field is not accepted at
    // all. Changing the identifier an account is recovered by needs
    // re-verification of the new address, and that flow does not exist — so a
    // well-formed one is dropped just as silently as "nope".
    const bad = updateUserSchema.safeParse({ email: "nope" });
    const good = updateUserSchema.safeParse({ email: "a@b.com" });
    expect(bad.success).toBe(true);
    expect(good.success).toBe(true);
    expect(bad.success && "email" in bad.data).toBe(false);
    expect(good.success && "email" in good.data).toBe(false);
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
