import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  advanceDueOrders,
  earnedStatus,
  FULFILMENT_SCHEDULE,
} from "@/lib/server/fulfillment";
import { getOrderById, updateOrderStatus } from "@/lib/server/orders";

/** Any fixed instant — the pure stage calculation doesn't care which. */
const SOME_TIME = "2026-07-08T09:00:00Z";
const since = (from: string, hours: number) =>
  new Date(Date.parse(from) + hours * 3_600_000);

/**
 * `hours` after the order was actually placed. Derived rather than hardcoded:
 * an earlier version of this file assumed 09:00 while o3 is placed at 09:15,
 * so "60 hours later" was quietly fifteen minutes short of the last threshold.
 */
async function afterPlacement(orderId: string, hours: number): Promise<Date> {
  const order = await getOrderById(orderId, db);
  return since(order!.placedAt, hours);
}

beforeEach(async () => {
  await resetToSnapshot(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("the stage an order has earned", () => {
  it("is still paid before the first threshold", () => {
    expect(earnedStatus(SOME_TIME, since(SOME_TIME, 0.5))).toBe("paid");
  });

  it("walks the schedule as time passes", () => {
    for (const stage of FULFILMENT_SCHEDULE) {
      expect(earnedStatus(SOME_TIME, since(SOME_TIME, stage.afterHours))).toBe(stage.status);
    }
  });

  it("stops at delivered however long it has been", () => {
    expect(earnedStatus(SOME_TIME, since(SOME_TIME, 10_000))).toBe("delivered");
  });
});

describe("advancing due orders", () => {
  it("moves an order through every intermediate stage, not just the last", async () => {
    // o3 is `paid`+`processing` and placed on the demo's today; jump three days.
    const before = await getOrderById("o3", db);
    await advanceDueOrders(await afterPlacement("o3", 72), db);

    const after = await getOrderById("o3", db);
    expect(after!.status).toBe("delivered");
    // The customer should still see it was packed before it shipped.
    const seen = after!.events.map((e) => e.status);
    for (const stage of FULFILMENT_SCHEDULE) expect(seen).toContain(stage.status);
    expect(after!.events.length).toBeGreaterThan(before!.events.length);
  });

  it("is idempotent — a second run changes nothing", async () => {
    await advanceDueOrders(await afterPlacement("o3", 72), db);
    const first = await getOrderById("o3", db);
    await advanceDueOrders(await afterPlacement("o3", 72), db);
    const second = await getOrderById("o3", db);
    expect(second!.status).toBe(first!.status);
    expect(second!.events.length).toBe(first!.events.length);
  });

  it("reaches the same place whether run often or once", async () => {
    // A frequent schedule, stepping at each threshold as it passes...
    for (const stage of FULFILMENT_SCHEDULE) {
      await advanceDueOrders(await afterPlacement("o3", stage.afterHours), db);
    }
    const stepwise = await getOrderById("o3", db);

    await resetToSnapshot(db);
    // ...versus the single daily run Hobby allows, catching up in one go.
    await advanceDueOrders(await afterPlacement("o3", 72), db);
    const catchUp = await getOrderById("o3", db);

    expect(catchUp!.status).toBe(stepwise!.status);
    expect(catchUp!.events.map((e) => e.status)).toEqual(
      stepwise!.events.map((e) => e.status)
    );
    // Runs the whole journey twice over a network database, so it needs more
    // than the default budget. Left slow rather than narrowed: comparing the
    // two cadences end to end is the entire point.
  }, 90_000);

  it("leaves an order alone until it has earned the next stage", async () => {
    const before = await getOrderById("o3", db);
    const report = await advanceDueOrders(await afterPlacement("o3", 0.25), db);
    const after = await getOrderById("o3", db);
    expect(after!.status).toBe(before!.status);
    expect(report.advanced.map((a) => a.orderId)).not.toContain("o3");
  });

  it("never touches a cancelled order", async () => {
    await updateOrderStatus("o3", "cancelled", {}, db);
    await advanceDueOrders(await afterPlacement("o3", 500), db);
    expect((await getOrderById("o3", db))!.status).toBe("cancelled");
  });

  it("never touches a delivered order", async () => {
    await advanceDueOrders(await afterPlacement("o3", 500), db);
    const delivered = await getOrderById("o1", db); // already delivered in the seed
    expect(delivered!.status).toBe("delivered");
    // and its timeline is untouched
    expect(delivered!.events.filter((e) => e.status === "delivered")).toHaveLength(1);
  });

  it("stamps a carrier and tracking number when it ships", async () => {
    await advanceDueOrders(await afterPlacement("o3", 30), db);
    const order = await getOrderById("o3", db);
    expect(order!.status).toBe("shipped");
    expect(order!.carrier).toBe("Leash Delivery");
    expect(order!.trackingNumber).toMatch(/^LEASH-\d{4}-\d{4}$/);
  });

  it("reports what it scanned and what it moved", async () => {
    const report = await advanceDueOrders(await afterPlacement("o3", 72), db);
    expect(report.scanned).toBeGreaterThan(0);
    expect(report.advanced.length).toBeGreaterThan(0);
    for (const move of report.advanced) expect(move.from).not.toBe(move.to);
  });

  it("notifies the customer as it goes", async () => {
    await advanceDueOrders(await afterPlacement("o3", 72), db);
    const kinds = (
      await db.notification.findMany({ where: { userId: "u1" } })
    ).map((n) => n.kind);
    expect(kinds).toContain("order_shipped");
    expect(kinds).toContain("order_delivered");
  });
});
