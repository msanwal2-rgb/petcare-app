import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  applyRating,
  refreshResponseRate,
  responseRateFrom,
} from "@/lib/server/reputation";
import { createBooking, updateBookingStatus } from "@/lib/server/bookings";
import {
  createAppointment,
  updateAppointmentStatus,
} from "@/lib/server/appointments";

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

const rate = (id: string, kind: "caretaker" | "vet" = "caretaker") =>
  kind === "vet"
    ? db.vetProfile.findUnique({ where: { id } }).then((p) => p!.responseRatePct)
    : db.caretakerProfile.findUnique({ where: { id } }).then((p) => p!.responseRatePct);

describe("the response-rate calculation", () => {
  it("is a whole percentage of requests answered", () => {
    expect(responseRateFrom(3, 1)).toBe(75);
    expect(responseRateFrom(1, 2)).toBe(33);
  });

  it("is 100 for someone nobody has asked yet", () => {
    // Nothing has gone unanswered, so there is nothing to hold against them.
    expect(responseRateFrom(0, 0)).toBe(100);
  });

  it("is 100 when everything was answered and 0 when nothing was", () => {
    expect(responseRateFrom(5, 0)).toBe(100);
    expect(responseRateFrom(0, 4)).toBe(0);
  });
});

describe("caretaker response rate", () => {
  it("is derived at seed time rather than hand-authored", async () => {
    // Every profile's stored value must equal what the rows imply.
    for (const profile of await db.caretakerProfile.findMany()) {
      const answered = await db.booking.count({
        where: {
          caretakerId: profile.id,
          status: { in: ["accepted", "declined", "in_progress", "completed"] },
        },
      });
      const waiting = await db.booking.count({
        where: { caretakerId: profile.id, status: "requested" },
      });
      expect(profile.responseRatePct).toBe(responseRateFrom(answered, waiting));
    }
  });

  it("rises when a pending request is answered", async () => {
    // b1 is a pending request for c1.
    const before = await rate("c1");
    await updateBookingStatus("b1", "accepted", db);
    expect(await rate("c1")).toBeGreaterThan(before);
  });

  it("rises just the same when a request is declined — replying is the point", async () => {
    const before = await rate("c1");
    await updateBookingStatus("b1", "declined", db);
    expect(await rate("c1")).toBeGreaterThan(before);
  });

  it("falls when a new request arrives unanswered", async () => {
    const before = await rate("c1");
    await createBooking(
      {
        ownerId: "u1",
        caretakerId: "c1",
        petIds: ["p1"],
        serviceType: "walking",
        startDateTime: "2026-09-01T09:00:00Z",
        endDateTime: "2026-09-01T10:00:00Z",
        notes: "",
      },
      db
    );
    expect(await rate("c1")).toBeLessThan(before);
  });

  it("ignores cancellations, which say nothing about responsiveness", async () => {
    const before = await rate("c1");
    await updateBookingStatus("b1", "cancelled", db);
    // b1 leaves the waiting pile without joining the answered one, so the
    // remaining history decides the number.
    const after = await rate("c1");
    expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe("vet response rate", () => {
  it("rises when a vet confirms a request", async () => {
    // a4 is pending for v1.
    const before = await rate("v1", "vet");
    await updateAppointmentStatus("a4", "confirmed", "vet", db);
    expect(await rate("v1", "vet")).toBeGreaterThan(before);
  });

  it("falls when a new appointment request arrives", async () => {
    const before = await rate("v1", "vet");
    // Two days out, measured from a fixed clock, so the lead-time rule is
    // satisfied without the fixture ageing into the past.
    const now = new Date("2026-09-01T09:00:00.000Z");
    const at = (h: number) =>
      new Date(now.getTime() + h * 3_600_000).toISOString();
    await createAppointment(
      "u1",
      {
        vetId: "v1",
        petId: "p1",
        mode: "in_clinic",
        reason: "Second opinion",
        symptoms: [],
        startDateTime: at(48),
        endDateTime: at(48.5),
        notes: "",
      },
      db,
      now
    );
    expect(await rate("v1", "vet")).toBeLessThan(before);
  });

  it("recomputes on demand without needing a status change", async () => {
    await db.vetProfile.update({ where: { id: "v2" }, data: { responseRatePct: 3 } });
    await refreshResponseRate("vet", "v2", db);
    expect(await rate("v2", "vet")).toBeGreaterThan(3);
  });
});

describe("ratings", () => {
  it("counts every review and never lets a bad one raise the score", async () => {
    const before = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    await applyRating("caretaker", before!.userId, 1, db);
    const after = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    expect(after!.reviewCount).toBe(before!.reviewCount + 1);
    expect(after!.rating).toBeLessThanOrEqual(before!.rating);
  });

  it("lets one bad review barely dent a long good history", async () => {
    const before = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    await applyRating("caretaker", before!.userId, 1, db);
    const after = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    // 127 good reviews absorb a single 1-star almost entirely...
    expect(before!.rating - after!.rating).toBeLessThan(0.05);
    // ...but it must still register. Rounding the stored value here would
    // swallow the change and freeze the rating forever.
    expect(after!.rating).toBeLessThan(before!.rating);
  });

  it("moves properly once the bad reviews add up", async () => {
    const before = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    for (let i = 0; i < 40; i++) {
      await applyRating("caretaker", before!.userId, 1, db);
    }
    const after = await db.caretakerProfile.findUnique({ where: { id: "c1" } });
    expect(after!.rating).toBeLessThan(before!.rating - 0.5);
  });

  it("does nothing for someone with no professional profile", async () => {
    // u1 is an owner only — this must be a no-op, not a crash.
    await expect(applyRating("caretaker", "u1", 5, db)).resolves.toBeUndefined();
  });
});
