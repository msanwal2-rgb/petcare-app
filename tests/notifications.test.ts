import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  listNotifications,
  markRead,
  notify,
  unreadCount,
} from "@/lib/server/notifications";
import { updateBookingStatus } from "@/lib/server/bookings";
import { updateAppointmentStatus } from "@/lib/server/appointments";
import { updateOrderStatus } from "@/lib/server/orders";

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

const kinds = async (userId: string) =>
  (await listNotifications(userId, db)).map((n) => n.kind);

describe("recording a notification", () => {
  it("stores it unread against the right person", async () => {
    const n = await notify(
      "u1",
      { kind: "order_shipped", title: "On its way", href: "/store/orders/o1" },
      db
    );
    expect(n!.id).toMatch(/^n_/);
    expect(n!.readAt).toBeNull();
    expect(await unreadCount("u1", db)).toBe(1);
    expect(await unreadCount("u2", db)).toBe(0);
  });

  it("lists newest first", async () => {
    await notify("u1", { kind: "order_shipped", title: "First", href: "/a" }, db);
    await notify("u1", { kind: "order_delivered", title: "Second", href: "/b" }, db);
    const titles = (await listNotifications("u1", db)).map((n) => n.title);
    expect(titles[0]).toBe("Second");
  });

  it("does not throw when the recipient does not exist", async () => {
    // A failure to notify must never roll back the thing being notified about.
    const n = await notify(
      "ghost",
      { kind: "order_shipped", title: "Nowhere", href: "/x" },
      db
    );
    expect(n).toBeNull();
  });
});

describe("marking read", () => {
  it("clears everything when given no id", async () => {
    await notify("u1", { kind: "order_shipped", title: "A", href: "/a" }, db);
    await notify("u1", { kind: "order_delivered", title: "B", href: "/b" }, db);
    expect(await markRead("u1", undefined, db)).toBe(2);
    expect(await unreadCount("u1", db)).toBe(0);
  });

  it("clears just the one when given an id", async () => {
    const first = await notify("u1", { kind: "order_shipped", title: "A", href: "/a" }, db);
    await notify("u1", { kind: "order_delivered", title: "B", href: "/b" }, db);
    await markRead("u1", first!.id, db);
    expect(await unreadCount("u1", db)).toBe(1);
  });

  it("refuses to clear somebody else's", async () => {
    const mine = await notify("u2", { kind: "order_shipped", title: "A", href: "/a" }, db);
    expect(await markRead("u1", mine!.id, db)).toBe(0);
    expect(await unreadCount("u2", db)).toBe(1);
  });
});

describe("what the status machines announce", () => {
  it("tells the owner when a caretaker accepts", async () => {
    await updateBookingStatus("b1", "accepted", db); // b1 belongs to u1
    expect(await kinds("u1")).toContain("booking_accepted");
  });

  it("tells the owner when a caretaker declines", async () => {
    await updateBookingStatus("b1", "declined", db);
    expect(await kinds("u1")).toContain("booking_declined");
  });

  it("says nothing when a booking is merely cancelled", async () => {
    // Whoever cancelled already knows; the other side sees it on the booking.
    await updateBookingStatus("b1", "cancelled", db);
    expect(await kinds("u1")).toEqual([]);
  });

  it("tells the owner when a vet confirms", async () => {
    await updateAppointmentStatus("a4", "confirmed", "vet", db); // a4 belongs to u1
    expect(await kinds("u1")).toContain("appointment_confirmed");
  });

  it("tells the owner when a visit summary is ready", async () => {
    await updateAppointmentStatus("a3", "in_progress", "vet", db);
    await updateAppointmentStatus("a3", "completed", "vet", db);
    expect(await kinds("u1")).toContain("appointment_completed");
  });

  it("announces the delivery milestones and nothing else", async () => {
    // o3 belongs to u1 and is `processing`.
    await updateOrderStatus("o3", "packed", {}, db);
    expect(await kinds("u1")).toEqual([]); // packing is warehouse noise

    await updateOrderStatus("o3", "shipped", {}, db);
    await updateOrderStatus("o3", "out_for_delivery", {}, db);
    await updateOrderStatus("o3", "delivered", {}, db);
    expect(await kinds("u1")).toEqual([
      "order_delivered",
      "order_out_for_delivery",
      "order_shipped",
    ]);
  });

  it("links each one at the thing it is about", async () => {
    await updateOrderStatus("o3", "packed", {}, db);
    await updateOrderStatus("o3", "shipped", {}, db);
    const [shipped] = await listNotifications("u1", db);
    expect(shipped.href).toBe("/store/orders/o3");
  });

  it("notifies the customer, not whoever moved the order", async () => {
    // o4 is Priya's (u3); ops advancing it must not notify ops.
    await updateOrderStatus("o4", "out_for_delivery", {}, db);
    expect(await kinds("u3")).toContain("order_out_for_delivery");
    expect(await kinds("u21")).toEqual([]);
  });
});
