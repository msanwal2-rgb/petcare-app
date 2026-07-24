import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testPrisma as db } from "./helpers/testdb";
import { seedDatabase } from "@/lib/server/seed";
import {
  createMessage,
  getMessagesForBooking,
  markMessagesRead,
} from "@/lib/server/messages";

beforeEach(async () => {
  await seedDatabase(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("messaging", () => {
  it("returns seeded messages oldest-first", async () => {
    const msgs = await getMessagesForBooking("b7", db);
    expect(msgs.length).toBe(3);
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i - 1].createdAt <= msgs[i].createdAt).toBe(true);
    }
  });

  it("creates a message on a booking", async () => {
    const m = await createMessage("b1", "u1", "Hello there!", db);
    expect(m.id).toMatch(/^m_/);
    expect(m.readAt).toBeNull();
    const all = await getMessagesForBooking("b1", db);
    expect(all.map((x) => x.body)).toContain("Hello there!");
  });

  it("marks the other party's messages as read", async () => {
    await createMessage("b1", "u1", "from owner", db);
    await createMessage("b1", "u7", "from caretaker", db);
    // u1 reads the thread -> only u7's message gets a readAt
    await markMessagesRead("b1", "u1", db);
    const msgs = await getMessagesForBooking("b1", db);
    const fromOwner = msgs.find((m) => m.fromUserId === "u1")!;
    const fromCaretaker = msgs.find((m) => m.fromUserId === "u7")!;
    expect(fromOwner.readAt).toBeNull();
    expect(fromCaretaker.readAt).not.toBeNull();
  });
});
