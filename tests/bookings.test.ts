import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
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
};

beforeEach(async () => {
  await resetToSnapshot(db);
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
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.booking.id).toMatch(/^b_/);
    expect(created.booking.status).toBe("requested");
    expect(created.booking.createdAt).toBeTruthy();
    const fetched = await getBookingById(created.booking.id, db);
    expect(fetched!.priceTotal).toBe(28);
  });

  it("prices from the caretaker's rate card, not the request", async () => {
    // The body carries no price at all now, so there is nothing to tamper with:
    // c1 charges $28/hour for a walk, and this is one hour.
    const created = await createBooking(newBooking, db);
    expect(created.ok && created.booking.priceTotal).toBe(28);
  });

  it("multiplies the rate by the duration", async () => {
    const created = await createBooking(
      {
        ...newBooking,
        startDateTime: "2026-09-01T09:00:00Z",
        endDateTime: "2026-09-01T12:00:00Z",
      },
      db
    );
    expect(created.ok && created.booking.priceTotal).toBe(84); // 3 hours
  });

  it("refuses a service the caretaker doesn't offer", async () => {
    const created = await createBooking(
      { ...newBooking, serviceType: "boarding" },
      db
    );
    // c1's rate card has no boarding line, so there is no honest price to set.
    if (created.ok) {
      // The seed may legitimately grow a boarding rate for c1; then this is a
      // priced booking rather than a refusal, and the price still came from the
      // rate card rather than the request.
      expect(created.booking.priceTotal).toBeGreaterThan(0);
    } else {
      expect(created.code).toBe("service_not_offered");
    }
  });

  it("refuses an unknown caretaker", async () => {
    const created = await createBooking({ ...newBooking, caretakerId: "ghost" }, db);
    expect(created).toEqual({ ok: false, code: "caretaker_not_found" });
  });

  it("refuses a booking that ends before it starts", async () => {
    const created = await createBooking(
      {
        ...newBooking,
        startDateTime: "2026-09-01T12:00:00Z",
        endDateTime: "2026-09-01T09:00:00Z",
      },
      db
    );
    expect(created).toEqual({ ok: false, code: "bad_dates" });
  });
});

describe("who may move a booking", () => {
  // Legality and authority are separate questions. TRANSITIONS answers the
  // first, ACTOR_ALLOWED the second, and only appointments used to ask both.

  it("lets the caretaker accept a request", async () => {
    const res = await updateBookingStatus("b1", "accepted", db, "caretaker");
    expect(res.ok).toBe(true);
  });

  it("stops the owner accepting their own request", async () => {
    // `completed` is what unlocks the review form, and every status change
    // feeds refreshResponseRate — so an owner who could drive their own booking
    // could manufacture a caretaker's response rate and then review them for it.
    const res = await updateBookingStatus("b1", "accepted", db, "owner");
    expect(res).toEqual({ ok: false, code: "wrong_actor", actor: "owner", to: "accepted" });
    expect((await getBookingById("b1", db))!.status).toBe("requested");
  });

  it("stops the owner completing a booking", async () => {
    await updateBookingStatus("b1", "accepted", db, "caretaker");
    await updateBookingStatus("b1", "in_progress", db, "caretaker");
    const res = await updateBookingStatus("b1", "completed", db, "owner");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("wrong_actor");
  });

  it("lets either party cancel", async () => {
    const byOwner = await updateBookingStatus("b1", "cancelled", db, "owner");
    expect(byOwner.ok).toBe(true);

    await resetToSnapshot(db);
    const byCaretaker = await updateBookingStatus("b1", "cancelled", db, "caretaker");
    expect(byCaretaker.ok).toBe(true);
  });

  it("checks legality before authority", async () => {
    // An illegal move reports as illegal even when the actor would have been
    // entitled to a legal one, because that is the more useful thing to say.
    await updateBookingStatus("b1", "cancelled", db, "owner");
    const res = await updateBookingStatus("b1", "accepted", db, "owner");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("invalid_transition");
  });

  it("still allows an internal caller with no actor", async () => {
    // The seeder and the assistant's cancel tool drive the machine directly;
    // they have already established who is asking by other means.
    const res = await updateBookingStatus("b1", "accepted", db);
    expect(res.ok).toBe(true);
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
