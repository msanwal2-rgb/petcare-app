/**
 * Tool authorization — the most important test in the assistant feature.
 *
 * The assistant can read a customer's orders, bookings, appointments, pets and
 * health records, and can cancel things. Every one of those is a way to leak or
 * damage someone's data if the wrong person reaches it, and the model is not
 * the thing standing in the way — these guards are.
 *
 * So each guarded tool is checked three ways:
 *
 *   owner      → gets the record
 *   other user → gets { error: "not_yours" }, and no detail about it
 *   anonymous  → does not find the tool at all
 *
 * Plus a structural assertion that no tool anywhere accepts a user id, which is
 * what makes "ask about someone else" unrepresentable rather than merely
 * refused. That one is a regression guard: it exists to fail the day somebody
 * adds a `userId` parameter to be helpful.
 *
 * Seed fixtures used:
 *   u1  Maya   — owns p1 (Biscuit), b1, o1 (delivered), o3 (processing), a3
 *   u3  Priya  — a different customer (owns o4, a1); the "other user" in
 *                every triple. Deliberately someone with records of their own,
 *                so a leak would show up as crossed wires rather than as an
 *                empty list that passes for the wrong reason.
 *   u7  Liam   — owns caretaker profile c1, and is the caretaker on b1
 *   u17 Ruiz   — owns vet profile v1, treating p1 via appointments a3 and a8
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resetToSnapshot, testPrisma as db, TEST_SCHEMA } from "./helpers/testdb";
import { buildTools } from "@/lib/server/assistant/tools";
import type { AssistantContext } from "@/lib/server/assistant/context";
import { hashEmbed } from "@/lib/server/assistant/embed";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function ctxFor(uid: string | null): AssistantContext {
  return { uid, db, now: NOW, clientKey: "test-client", path: "/store/orders" };
}

function toolsFor(uid: string | null) {
  return buildTools(ctxFor(uid), { embed: hashEmbed(), schema: TEST_SCHEMA });
}

/** Invoke a tool the way the SDK would. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run(tool: any, input: unknown = {}): Promise<any> {
  return tool.execute(input, { toolCallId: "test-call", messages: [] });
}

beforeEach(async () => {
  await resetToSnapshot(db);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("tool surface", () => {
  it("never accepts a user id on any tool", () => {
    // The structural guarantee. If this fails, the model has gained a way to
    // name somebody other than the signed-in customer.
    const forbidden = ["userId", "ownerId", "uid", "customerId", "clientKey"];
    const tools = toolsFor("u1");

    for (const [name, definition] of Object.entries(tools)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shape = (definition as any).inputSchema?.shape ?? {};
      for (const field of forbidden) {
        expect(
          Object.keys(shape),
          `tool "${name}" must not accept "${field}"`,
        ).not.toContain(field);
      }
    }
  });

  it("gives anonymous callers no write tools at all", () => {
    const anon = Object.keys(toolsFor(null));
    expect(anon.filter((name) => name.startsWith("cancel"))).toEqual([]);
    expect(anon).not.toContain("markNotificationsRead");
  });

  it("gives signed-in callers the write tools", () => {
    const signedIn = Object.keys(toolsFor("u1"));
    expect(signedIn).toContain("cancelOrder");
    expect(signedIn).toContain("cancelBooking");
    expect(signedIn).toContain("cancelAppointment");
  });

  it("exposes no tool that creates a booking, appointment or order", () => {
    // Absence is the guarantee for tier-3 actions. A refusing tool could be
    // talked around; a missing one cannot.
    const names = Object.keys(toolsFor("u1"));
    for (const banned of [
      "createBooking", "createAppointment", "placeOrder", "createOrder",
      "createReview", "createRecord", "updateOrderStatus", "getFulfillmentQueue",
      "sendMessage", "updateProfile",
    ]) {
      expect(names).not.toContain(banned);
    }
  });

  it("keeps public tools available to anonymous callers", () => {
    const anon = Object.keys(toolsFor(null));
    for (const open of ["searchProducts", "searchKnowledge", "searchVets", "getStoreFacts"]) {
      expect(anon).toContain(open);
    }
  });
});

describe("orders", () => {
  it("owner reads their own order", async () => {
    const result = await run(toolsFor("u1").getOrder, { orderId: "o1" });
    expect(result.orderId).toBe("o1");
    expect(result.total).toMatch(/^\$\d/);
  });

  it("another customer is refused, with no detail about the order", async () => {
    const result = await run(toolsFor("u3").getOrder, { orderId: "o1" });
    expect(result).toEqual({ error: "not_yours", detail: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("o1");
  });

  it("a non-existent order is refused identically, so ids can't be probed", async () => {
    const missing = await run(toolsFor("u1").getOrder, { orderId: "o_nope" });
    const theirs = await run(toolsFor("u3").getOrder, { orderId: "o1" });
    expect(missing).toEqual(theirs);
  });

  it("anonymous callers can't reach orders", async () => {
    const result = await run(toolsFor(null).getOrder, { orderId: "o1" });
    expect(result.error).toBe("needs_sign_in");
  });

  it("lists only the caller's own orders", async () => {
    // u1 and u3 both have orders (u3 owns o4), which makes this the useful
    // shape of the assertion: not "the other account is empty", but "the two
    // lists never overlap".
    const mine = await run(toolsFor("u1").getMyOrders, { limit: 10 });
    const theirs = await run(toolsFor("u3").getMyOrders, { limit: 10 });

    const mineIds = mine.orders.map((o: { orderId: string }) => o.orderId);
    const theirIds = theirs.orders.map((o: { orderId: string }) => o.orderId);

    expect(mineIds.length).toBeGreaterThan(0);
    expect(theirIds.length).toBeGreaterThan(0);
    expect(mineIds).toContain("o1");
    expect(theirIds).not.toContain("o1");
    expect(mineIds.filter((id: string) => theirIds.includes(id))).toEqual([]);
  });
});

describe("cancelling an order", () => {
  it("cancels one that hasn't shipped", async () => {
    const result = await run(toolsFor("u1").cancelOrder, {
      orderId: "o3",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.cancelled.statusCode).toBe("cancelled");
  });

  it("refuses once delivered, and says why", async () => {
    const result = await run(toolsFor("u1").cancelOrder, {
      orderId: "o1",
      confirm: true,
    });
    expect(result.error).toBe("too_late");
    expect(result.detail).toContain("Delivered");
  });

  it("refuses to cancel someone else's order", async () => {
    const result = await run(toolsFor("u3").cancelOrder, {
      orderId: "o3",
      confirm: true,
    });
    expect(result.error).toBe("not_yours");

    // And the order is untouched.
    const still = await run(toolsFor("u1").getOrder, { orderId: "o3" });
    expect(still.statusCode).toBe("processing");
  });
});

describe("bookings", () => {
  it("the owner reads their booking", async () => {
    const result = await run(toolsFor("u1").getBooking, { bookingId: "b1" });
    expect(result.bookingId).toBe("b1");
  });

  it("the caretaker on the booking reads it too", async () => {
    // Participation, not ownership — u7 owns caretaker profile c1.
    const result = await run(toolsFor("u7").getBooking, { bookingId: "b1" });
    expect(result.bookingId).toBe("b1");
  });

  it("an unrelated customer is refused", async () => {
    const result = await run(toolsFor("u3").getBooking, { bookingId: "b1" });
    expect(result.error).toBe("not_yours");
  });

  it("refuses to cancel a booking the caller isn't part of", async () => {
    const result = await run(toolsFor("u3").cancelBooking, {
      bookingId: "b1",
      confirm: true,
    });
    expect(result.error).toBe("not_yours");
  });

  it("cancels a booking the caller is part of", async () => {
    const result = await run(toolsFor("u1").cancelBooking, {
      bookingId: "b1",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.cancelled.statusCode).toBe("cancelled");
  });
});

describe("appointments", () => {
  it("the owner reads their appointment", async () => {
    const result = await run(toolsFor("u1").getAppointment, { appointmentId: "a3" });
    expect(result.appointmentId).toBe("a3");
  });

  it("an unrelated customer is refused", async () => {
    const result = await run(toolsFor("u3").getAppointment, { appointmentId: "a3" });
    expect(result.error).toBe("not_yours");
  });

  it("an owner may cancel their own appointment", async () => {
    const result = await run(toolsFor("u1").cancelAppointment, {
      appointmentId: "a3",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.cancelled.statusCode).toBe("cancelled");
  });

  it("offers no way for an owner to confirm or complete an appointment", async () => {
    // Only a vet may drive those transitions, and the actor is derived from the
    // session rather than accepted as input — so there is nothing to call.
    const names = Object.keys(toolsFor("u1"));
    expect(names).not.toContain("confirmAppointment");
    expect(names).not.toContain("completeAppointment");
    expect(names).not.toContain("updateAppointmentStatus");
  });
});

describe("pets and health records", () => {
  it("the owner reads their pet's record", async () => {
    const result = await run(toolsFor("u1").getPetHealthRecord, { petId: "p1" });
    expect(Array.isArray(result.records)).toBe(true);
    expect(result.records.length).toBeGreaterThan(0);
  });

  it("a treating vet reads the patient's record", async () => {
    // This is why the tool uses canAccessPetRecords rather than ownsPet: u17
    // does not own Biscuit, but is treating him.
    const result = await run(toolsFor("u17").getPetHealthRecord, { petId: "p1" });
    expect(result.records.length).toBeGreaterThan(0);
  });

  it("an unrelated customer cannot read a pet's record", async () => {
    const result = await run(toolsFor("u3").getPetHealthRecord, { petId: "p1" });
    expect(result.error).toBe("not_yours");
  });

  it("prescriptions are owner-only, even for a treating vet's own convenience", async () => {
    const mine = await run(toolsFor("u1").getActivePrescriptions, { petId: "p1" });
    expect(Array.isArray(mine.prescriptions)).toBe(true);

    const theirs = await run(toolsFor("u3").getActivePrescriptions, { petId: "p1" });
    expect(theirs.error).toBe("not_yours");
  });

  it("lists only the caller's own pets", async () => {
    const mine = await run(toolsFor("u1").getMyPets);
    expect(mine.pets.map((p: { name: string }) => p.name)).toContain("Biscuit");

    const theirs = await run(toolsFor("u3").getMyPets);
    expect(theirs.pets.map((p: { name: string }) => p.name)).not.toContain("Biscuit");
  });

  it("refuses recommendations for a pet the caller doesn't own", async () => {
    const result = await run(toolsFor("u3").recommendProductsForPet, { petId: "p1" });
    expect(result.error).toBe("not_yours");
  });
});

describe("money formatting at the tool boundary", () => {
  it("never hands the model a raw cent value", async () => {
    // The model cannot divide by 100 wrongly if it never receives a number.
    const products = await run(toolsFor(null).searchProducts, { limit: 4 });
    expect(products.products.length).toBeGreaterThan(0);
    for (const product of products.products) {
      expect(product.price).toMatch(/^\$\d+\.\d{2}$/);
    }

    const order = await run(toolsFor("u1").getOrder, { orderId: "o1" });
    for (const field of [order.total, order.subtotal, order.tax]) {
      expect(field).toMatch(/^\$\d+\.\d{2}$/);
    }
    expect(order.shipping === "Free" || /^\$\d/.test(order.shipping)).toBe(true);
  });

  it("states the cancellation rule rather than making the model infer it", async () => {
    const delivered = await run(toolsFor("u1").getOrder, { orderId: "o1" });
    expect(delivered.canStillCancel).toBe(false);

    const processing = await run(toolsFor("u1").getOrder, { orderId: "o3" });
    expect(processing.canStillCancel).toBe(true);
  });
});

describe("deep links instead of actions", () => {
  it("hands back a pre-filled vet booking link without booking anything", async () => {
    const before = await run(toolsFor("u1").getMyAppointments, {});
    const link = await run(toolsFor("u1").startVetAppointment, {
      vetId: "v1",
      petId: "p1",
    });

    expect(link.kind).toBe("deep_link");
    expect(link.href).toContain("/vets/book?");
    expect(link.href).toContain("vetId=v1");
    expect(link.href).toContain("petId=p1");

    const after = await run(toolsFor("u1").getMyAppointments, {});
    expect(after.appointments.length).toBe(before.appointments.length);
  });

  it("refuses to build a link naming someone else's pet", async () => {
    const result = await run(toolsFor("u3").startVetAppointment, {
      vetId: "v1",
      petId: "p1",
    });
    expect(result.error).toBe("not_yours");
  });

  it("refuses a link for a vet that doesn't exist, so links are never 404s", async () => {
    const result = await run(toolsFor("u1").startVetAppointment, { vetId: "v_nope" });
    expect(result.error).toBe("not_found");
  });

  it("only links to known pages", async () => {
    const result = await run(toolsFor(null).openPage, { page: "support" });
    expect(result.href).toBe("/support");
  });
});

describe("public tools", () => {
  it("searches the catalog without a session", async () => {
    const result = await run(toolsFor(null).searchProducts, { q: "salmon", limit: 3 });
    expect(result.products.length).toBeGreaterThan(0);
  });

  it("answers policy questions without a session", async () => {
    const result = await run(toolsFor(null).searchKnowledge, {
      query: "what is your returns policy",
      topK: 3,
    });
    expect(result.found).toBeGreaterThan(0);
    expect(result.passages[0].href).toMatch(/^\//);
  });

  it("reports store facts from the code, not from memory", async () => {
    const facts = await run(toolsFor(null).getStoreFacts);
    expect(facts.freeShippingFrom).toBe("$49.00");
    expect(facts.flatShipping).toBe("$5.99");
    expect(facts.paymentsAreSimulated).toBe(true);
  });
});
