/**
 * Conversation persistence and its access scoping.
 *
 * The interesting cases are the negative ones: another customer must not be
 * able to read a thread, and an anonymous thread must not leak to the next
 * visitor on a shared machine.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db } from "./helpers/testdb";
import {
  appendMessages,
  createConversation,
  deleteConversation,
  ensureConversation,
  getConversationForCaller,
  listConversationsByUser,
} from "@/lib/server/assistant/conversations";
import type { AssistantContext } from "@/lib/server/assistant/context";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function ctxFor(uid: string | null, clientKey = "client-a"): AssistantContext {
  return { uid, db, now: NOW, clientKey, path: "/" };
}

beforeEach(async () => {
  await resetToSnapshot(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("conversations", () => {
  it("creates and reads back a thread", async () => {
    const ctx = ctxFor("u1");
    const created = await createConversation(ctx);
    expect(created.id).toMatch(/^ac_/);

    const found = await getConversationForCaller(ctx, created.id);
    expect(found?.id).toBe(created.id);
    expect(found?.messages).toEqual([]);
  });

  it("stores the full parts array, not just text", async () => {
    // This is what lets a reloaded thread re-render its tool cards.
    const ctx = ctxFor("u1");
    const convo = await createConversation(ctx);
    const parts = [
      { type: "text", text: "Where is my order?" },
      { type: "tool-getMyOrders", toolCallId: "c1", state: "output-available" },
    ];

    await appendMessages(ctx, convo.id, [
      { role: "user", parts, text: "Where is my order?" },
    ]);

    const found = await getConversationForCaller(ctx, convo.id);
    expect(found?.messages[0].parts).toEqual(parts);
    expect(found?.messages[0].text).toBe("Where is my order?");
  });

  it("keeps messages in the order they were said", async () => {
    const ctx = ctxFor("u1");
    const convo = await createConversation(ctx);
    await appendMessages(ctx, convo.id, [
      { role: "user", parts: [], text: "first" },
      { role: "assistant", parts: [], text: "second" },
    ]);

    const found = await getConversationForCaller(ctx, convo.id);
    expect(found?.messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("titles a thread from its first question", async () => {
    const ctx = ctxFor("u1");
    const convo = await createConversation(ctx);
    await appendMessages(ctx, convo.id, [
      { role: "user", parts: [], text: "Why was I charged shipping?" },
    ]);

    const [listed] = await listConversationsByUser("u1", db);
    expect(listed.id).toBe(convo.id);
    expect(listed.title).toBe("Why was I charged shipping?");
  });
});

describe("access scoping", () => {
  it("hides one customer's thread from another", async () => {
    const mine = ctxFor("u1");
    const convo = await createConversation(mine);

    const theirs = ctxFor("u3");
    expect(await getConversationForCaller(theirs, convo.id)).toBeNull();
  });

  it("returns null rather than forbidden, so ids can't be probed", async () => {
    const ctx = ctxFor("u1");
    expect(await getConversationForCaller(ctx, "ac_does_not_exist")).toBeNull();
  });

  it("keeps an anonymous thread to the client key that made it", async () => {
    const first = ctxFor(null, "client-a");
    const convo = await createConversation(first);

    // Same machine, same key — fine.
    expect(await getConversationForCaller(first, convo.id)).not.toBeNull();

    // A different visitor must not inherit it.
    const second = ctxFor(null, "client-b");
    expect(await getConversationForCaller(second, convo.id)).toBeNull();
  });

  it("does not hand an anonymous thread to a signed-in user with the same key", async () => {
    // Signing in mid-conversation must not adopt the anonymous history, or a
    // shared browser would leak one visitor's questions into another's account.
    const anon = ctxFor(null, "client-a");
    const convo = await createConversation(anon);

    const signedIn = ctxFor("u1", "client-a");
    expect(await getConversationForCaller(signedIn, convo.id)).toBeNull();
  });

  it("refuses to delete someone else's thread", async () => {
    const mine = ctxFor("u1");
    const convo = await createConversation(mine);

    expect(await deleteConversation(ctxFor("u3"), convo.id)).toBe(false);
    expect(await getConversationForCaller(mine, convo.id)).not.toBeNull();
  });

  it("deletes a thread and its messages together", async () => {
    const ctx = ctxFor("u1");
    const convo = await createConversation(ctx);
    await appendMessages(ctx, convo.id, [{ role: "user", parts: [], text: "hello" }]);

    expect(await deleteConversation(ctx, convo.id)).toBe(true);
    expect(await getConversationForCaller(ctx, convo.id)).toBeNull();
    expect(
      await db.assistantMessage.count({ where: { conversationId: convo.id } }),
    ).toBe(0);
  });

  it("takes conversations with the user when the account is deleted", async () => {
    const ctx = ctxFor("u1");
    const convo = await createConversation(ctx);
    await appendMessages(ctx, convo.id, [{ role: "user", parts: [], text: "hello" }]);

    await db.user.delete({ where: { id: "u1" } });

    expect(await db.assistantConversation.count({ where: { id: convo.id } })).toBe(0);
    expect(
      await db.assistantMessage.count({ where: { conversationId: convo.id } }),
    ).toBe(0);
  });
});

describe("ensureConversation", () => {
  it("reuses a thread the caller owns", async () => {
    const ctx = ctxFor("u1");
    const first = await createConversation(ctx);
    const again = await ensureConversation(ctx, first.id);
    expect(again.id).toBe(first.id);
  });

  it("starts a fresh thread rather than erroring on someone else's id", async () => {
    const mine = await createConversation(ctxFor("u1"));
    const theirs = await ensureConversation(ctxFor("u3"), mine.id);
    expect(theirs.id).not.toBe(mine.id);
  });
});
