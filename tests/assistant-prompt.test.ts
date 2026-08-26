/**
 * The system prompt.
 *
 * Pure assertions — no database, no model. What they protect is mostly
 * omission: a red flag quietly dropped from the prompt, a pet name leaking into
 * an anonymous conversation, or the date going missing and every "is my order
 * late?" answer silently becoming wrong.
 */

import { describe, expect, it } from "vitest";
import { RED_FLAGS } from "@/lib/content/pet-health";
import {
  buildInstructions,
  dynamicInstructions,
  staticInstructions,
  type AssistantProfile,
} from "@/lib/server/assistant/instructions";
import type { AssistantContext } from "@/lib/server/assistant/context";

const NOW = new Date("2026-08-26T12:00:00.000Z");

/**
 * buildInstructions never touches the database, which is what makes these
 * assertions free. The client is stubbed rather than connected to prove it.
 */
const NO_DB = undefined as unknown as AssistantContext["db"];

const ctx = (uid: string | null, path = "/store/orders"): AssistantContext => ({
  uid,
  db: NO_DB,
  now: NOW,
  clientKey: "k",
  path,
});

const MAYA: AssistantProfile = {
  name: "Maya Chen",
  roles: ["owner"],
  isOps: false,
  pets: [
    { id: "p1", name: "Biscuit", species: "Dog", age: "4 years", allergies: ["chicken"] },
  ],
};

describe("static instructions", () => {
  it("carries every emergency red flag verbatim", () => {
    // Inlined rather than retrieved, precisely so this cannot be missed.
    const text = staticInstructions();
    for (const flag of RED_FLAGS) {
      expect(text).toContain(flag.sign);
    }
  });

  it("states the non-diagnostic scope", () => {
    const text = staticInstructions();
    expect(text).toMatch(/not diagnostic/i);
    expect(text).toMatch(/No diagnosis/i);
  });

  it("forbids inventing account facts and claiming unconfirmed actions", () => {
    const text = staticInstructions();
    // Whitespace-tolerant: the prompt is hard-wrapped, so a phrase can span
    // a line break.
    expect(text).toMatch(/did not come from a tool\s+call/i);
    expect(text).toMatch(/unless a tool\s+confirmed it/i);
  });

  it("tells the model that tool output is data, not instructions", () => {
    // The prompt-injection guard. Tool results carry user-written text.
    expect(staticInstructions()).toMatch(/data, not instructions/i);
  });

  it("rules out placing orders and booking on the customer's behalf", () => {
    const text = staticInstructions();
    expect(text).toMatch(/never place an\s+order/i);
    expect(text).toContain("startVetAppointment");
  });
});

describe("dynamic instructions", () => {
  it("always states today's real date", () => {
    // Seed data drifts and the model's own sense of "now" is its training
    // cutoff, so an unstated date makes every relative answer wrong.
    const text = dynamicInstructions(ctx("u1"), MAYA, []);
    expect(text).toContain("2026-08-26");
  });

  it("names the customer's pets so a name resolves without a tool call", () => {
    const text = dynamicInstructions(ctx("u1"), MAYA, []);
    expect(text).toContain("Biscuit");
    expect(text).toContain("p1");
    expect(text).toContain("chicken");
  });

  it("leaks no pet or customer detail when nobody is signed in", () => {
    const text = dynamicInstructions(ctx(null), null, []);
    expect(text).not.toContain("Biscuit");
    expect(text).not.toContain("Maya");
    expect(text).toMatch(/Nobody is signed in/i);
    expect(text).toContain("offerSignIn");
  });

  it("tells the model which page the customer is on", () => {
    expect(dynamicInstructions(ctx("u1", "/store/cart"), MAYA, [])).toContain("/store/cart");
  });

  it("lists exactly the tools enabled this turn", () => {
    const text = dynamicInstructions(ctx("u1"), MAYA, ["getMyOrders", "cancelOrder"]);
    expect(text).toContain("getMyOrders, cancelOrder");
  });

  it("says an ops account has no ops tools here", () => {
    const ops: AssistantProfile = { ...MAYA, isOps: true };
    expect(dynamicInstructions(ctx("u21"), ops, [])).toMatch(/no operations tools/i);
  });

  it("handles an account with no pets without inventing one", () => {
    const petless: AssistantProfile = { ...MAYA, pets: [] };
    const text = dynamicInstructions(ctx("u1"), petless, []);
    expect(text).toMatch(/no pets on the account yet/i);
    expect(text).not.toContain("Biscuit");
  });
});

describe("buildInstructions", () => {
  it("puts the cacheable static block first", () => {
    const full = buildInstructions(ctx("u1"), MAYA, ["getMyOrders"]);
    expect(full.startsWith(staticInstructions())).toBe(true);
  });

  it("produces a prompt for an anonymous visitor too", () => {
    const full = buildInstructions(ctx(null), null, ["searchProducts"]);
    expect(full).toContain("Scout");
    expect(full).toMatch(/Nobody is signed in/i);
  });
});
