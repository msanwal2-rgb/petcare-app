import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import Stripe from "stripe";

/**
 * Webhook signature verification.
 *
 * The one thing the fake provider cannot cover, and the one thing worth a file
 * of its own: if this check is wrong, `/api/webhooks/stripe` is an open,
 * unauthenticated endpoint that marks orders paid on request.
 *
 * Runs offline against the real `stripe` library with a made-up secret — no
 * account, no key, no network.
 */

const SECRET = "whsec_test_secret_for_signature_verification";

/** Build the `Stripe-Signature` header the way Stripe does. */
function sign(payload: string, secret: string, timestamp: number): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const stripe = new Stripe("sk_test_not_a_real_key", {
  apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
});

const payload = JSON.stringify({
  id: "evt_test",
  object: "event",
  type: "payment_intent.succeeded",
  created: 1_800_000_000,
  data: { object: { id: "pi_test" } },
});

describe("stripe webhook signatures", () => {
  it("accepts a correctly signed payload", () => {
    const now = Math.floor(Date.now() / 1000);
    const event = stripe.webhooks.constructEvent(
      payload,
      sign(payload, SECRET, now),
      SECRET
    );
    expect(event.id).toBe("evt_test");
    expect(event.type).toBe("payment_intent.succeeded");
  });

  it("rejects a payload that was tampered with after signing", () => {
    // The attack this stops: take a real event, change the amount, resend it.
    const now = Math.floor(Date.now() / 1000);
    const signature = sign(payload, SECRET, now);
    const tampered = payload.replace("pi_test", "pi_attacker");

    expect(() =>
      stripe.webhooks.constructEvent(tampered, signature, SECRET)
    ).toThrow();
  });

  it("rejects a signature made with the wrong secret", () => {
    const now = Math.floor(Date.now() / 1000);
    expect(() =>
      stripe.webhooks.constructEvent(
        payload,
        sign(payload, "whsec_someone_elses_secret", now),
        SECRET
      )
    ).toThrow();
  });

  it("rejects a replayed signature that is too old", () => {
    // Stripe's default tolerance is five minutes. Without this, an intercepted
    // signed request stays valid forever.
    const longAgo = Math.floor(Date.now() / 1000) - 60 * 60;
    expect(() =>
      stripe.webhooks.constructEvent(payload, sign(payload, SECRET, longAgo), SECRET)
    ).toThrow();
  });

  it("rejects a missing signature header", () => {
    expect(() => stripe.webhooks.constructEvent(payload, "", SECRET)).toThrow();
  });

  it("rejects a re-serialised body", () => {
    // Why the route reads request.text() and must never use parseBody: parsing
    // and re-stringifying produces different bytes, and the signature is over
    // the bytes.
    const now = Math.floor(Date.now() / 1000);
    const signature = sign(payload, SECRET, now);
    const reserialised = JSON.stringify(JSON.parse(payload), null, 2);

    expect(() =>
      stripe.webhooks.constructEvent(reserialised, signature, SECRET)
    ).toThrow();
  });
});
