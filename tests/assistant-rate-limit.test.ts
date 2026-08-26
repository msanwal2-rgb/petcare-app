/**
 * Rate limiting.
 *
 * The window is the part worth testing carefully: a bucket that resets on the
 * hour lets someone spend two hours' budget in the two minutes either side of
 * it. These assertions pin the sliding behaviour, and that anonymous callers
 * are counted separately from signed-in ones.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import { checkRateLimit, LIMITS } from "@/lib/server/assistant/rate-limit";
import type { AssistantContext } from "@/lib/server/assistant/context";
import { genId } from "@/lib/server/ids";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function ctxFor(uid: string | null, clientKey = "client-a"): AssistantContext {
  return { uid, db, now: NOW, clientKey, path: "/" };
}

/** Plant `count` user messages, each `minutesAgo` old. */
async function plant(
  { uid, clientKey }: { uid: string | null; clientKey: string },
  count: number,
  minutesAgo: number,
) {
  const conversationId = genId("ac");
  const at = new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
  await db.assistantConversation.create({
    data: { id: conversationId, userId: uid, clientKey, title: "", createdAt: at, updatedAt: at },
  });
  await db.assistantMessage.createMany({
    data: Array.from({ length: count }, () => ({
      id: genId("am"),
      conversationId,
      role: "user",
      parts: [],
      text: "hello",
      createdAt: at,
    })),
  });
}

beforeEach(async () => {
  await resetToSnapshot(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("rate limiting", () => {
  it("allows a first message", async () => {
    expect((await checkRateLimit(ctxFor("u1"))).allowed).toBe(true);
  });

  it("blocks exactly at the signed-in hourly limit, not before", async () => {
    await plant({ uid: "u1", clientKey: "k" }, LIMITS.signedIn.perHour - 1, 10);
    expect((await checkRateLimit(ctxFor("u1"))).allowed).toBe(true);

    await plant({ uid: "u1", clientKey: "k" }, 1, 10);
    const verdict = await checkRateLimit(ctxFor("u1"));
    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe("hour");
  });

  it("blocks anonymous callers much sooner", async () => {
    await plant({ uid: null, clientKey: "client-a" }, LIMITS.anonymous.perHour, 5);
    const verdict = await checkRateLimit(ctxFor(null, "client-a"));
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("Signing in");
  });

  it("slides: a message just over an hour old no longer counts", async () => {
    // The whole reason for a sliding window rather than an hourly bucket.
    await plant({ uid: "u1", clientKey: "k" }, LIMITS.signedIn.perHour, 61);
    const verdict = await checkRateLimit(ctxFor("u1"));
    expect(verdict.allowed).toBe(true);
  });

  it("still enforces the daily cap once the hour has rolled off", async () => {
    await plant({ uid: "u1", clientKey: "k" }, LIMITS.signedIn.perDay, 120);
    const verdict = await checkRateLimit(ctxFor("u1"));
    expect(verdict.allowed).toBe(false);
    expect(verdict.window).toBe("day");
  });

  it("counts anonymous visitors by client key, not globally", async () => {
    await plant({ uid: null, clientKey: "client-a" }, LIMITS.anonymous.perHour, 5);

    expect((await checkRateLimit(ctxFor(null, "client-a"))).allowed).toBe(false);
    // A different visitor is unaffected.
    expect((await checkRateLimit(ctxFor(null, "client-b"))).allowed).toBe(true);
  });

  it("counts signed-in customers by user, not by client key", async () => {
    // Same person on a second device shares one budget.
    await plant({ uid: "u1", clientKey: "device-1" }, LIMITS.signedIn.perHour, 5);
    expect((await checkRateLimit(ctxFor("u1", "device-2"))).allowed).toBe(false);
  });

  it("does not count another customer's messages against you", async () => {
    await plant({ uid: "u3", clientKey: "k" }, LIMITS.signedIn.perHour, 5);
    expect((await checkRateLimit(ctxFor("u1"))).allowed).toBe(true);
  });

  it("counts only user messages, not the assistant's replies", async () => {
    const conversationId = genId("ac");
    const at = new Date(NOW.getTime() - 60_000).toISOString();
    await db.assistantConversation.create({
      data: { id: conversationId, userId: "u1", clientKey: "k", title: "", createdAt: at, updatedAt: at },
    });
    await db.assistantMessage.createMany({
      data: Array.from({ length: LIMITS.signedIn.perHour }, () => ({
        id: genId("am"),
        conversationId,
        role: "assistant",
        parts: [],
        text: "sure",
        createdAt: at,
      })),
    });

    expect((await checkRateLimit(ctxFor("u1"))).allowed).toBe(true);
  });
});
