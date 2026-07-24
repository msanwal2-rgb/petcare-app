import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  createBooking,
  getBookingById,
  getBookingsByCaretaker,
  getBookingsByOwner,
  updateBookingStatus,
} from "@/lib/server/bookings";

const newBooking = {
  ownerId: "u1",
  caretakerId: "c1",
  petIds: ["p1"],
  serviceType: "walking" as const,
  startDateTime: "2026-08-01T09:00:00Z",
  endDateTime: "2026-08-01T10:00:00Z",
  notes: "Test booking",
  priceTotal: 28,
};

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("booking reads", () => {
  it("lists an owner's bookings newest-first", async () => {
    const bookings = await getBookingsByOwner("u1", db);
    expect(bookings.length).toBeGreaterThan(0);
    for (let i = 1; i < bookings.length; i++) {
      expect(
        bookings[i - 1].createdAt >= bookings[i].createdAt
      ).toBe(true);
    }
  });

  it("returns [] for an owner with no bookings", async () => {
    expect(await getBookingsByOwner("u7", db)).toEqual([]);
  });

  it("lists a caretaker's bookings", async () => {
    const bookings = await getBookingsByCaretaker("c1", db);
    expect(bookings.every((b) => b.caretakerId === "c1")).toBe(true);
  });

  it("gets a booking by id", async () => {
    const b = await getBookingById("b1", db);
    expect(b!.status).toBe("requested");
    expect(b!.petIds).toEqual(["p1"]);
  });

  it("returns null for an unknown booking", async () => {
    expect(await getBookingById("nope", db)).toBeNull();
  });
});

describe("booking creation", () => {
  it("creates a booking in the requested state with a server timestamp", async () => {
    const created = await createBooking(newBooking, db);
    expect(created.id).toMatch(/^b_/);
    expect(created.status).toBe("requested");
    expect(created.createdAt).toBeTruthy();
    const fetched = await getBookingById(created.id, db);
    expect(fetched!.priceTotal).toBe(28);
  });
});

describe("booking status lifecycle", () => {
  it("accepts a valid transition requested → accepted", async () => {
    const res = await updateBookingStatus("b1", "accepted", db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.booking.status).toBe("accepted");
  });

  it("walks the full happy path requested → accepted → in_progress → completed", async () => {
    await updateBookingStatus("b1", "accepted", db);
    await updateBookingStatus("b1", "in_progress", db);
    const res = await updateBookingStatus("b1", "completed", db);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.booking.status).toBe("completed");
  });

  it("allows cancelling from requested", async () => {
    const res = await updateBookingStatus("b1", "cancelled", db);
    expect(res.ok).toBe(true);
  });

  it("rejects skipping requested → in_progress", async () => {
    const res = await updateBookingStatus("b1", "in_progress", db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_transition");
  });

  it("rejects changing a completed (terminal) booking", async () => {
    // b9 is seeded as completed
    const res = await updateBookingStatus("b9", "in_progress", db);
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "invalid_transition") {
      expect(res.from).toBe("completed");
    }
  });

  it("rejects reviving a declined booking", async () => {
    // b13 is seeded as declined
    const res = await updateBookingStatus("b13", "accepted", db);
    expect(res.ok).toBe(false);
  });

  it("reports not_found for an unknown booking", async () => {
    const res = await updateBookingStatus("ghost", "accepted", db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("not_found");
  });

  it("treats a no-op same-status update as valid", async () => {
    const res = await updateBookingStatus("b1", "requested", db);
    expect(res.ok).toBe(true);
  });
});
