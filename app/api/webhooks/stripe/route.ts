import type Stripe from "stripe";
import { stripeClient } from "@/lib/server/payments/stripe-client";
import { handleStripeEvent } from "@/lib/server/webhooks/stripe";
import {
  claimEvent,
  markFailed,
  markProcessed,
  markSkipped,
} from "@/lib/server/webhooks/store";

/**
 * Stripe's webhook endpoint.
 *
 * The one route in this app that must NOT use `parseBody`. Signature
 * verification is computed over the exact bytes Stripe sent, and `parseBody`
 * consumes the stream as JSON — re-serialising it afterwards produces a
 * different string and the signature never matches. So: `request.text()`,
 * verify, and only then look at the contents.
 *
 * `proxy.ts` does not match /api, so nothing upstream touches this. Do not
 * widen that matcher.
 *
 * Registering it: https://dashboard.stripe.com/webhooks, pointed at
 * `https://<your-domain>/api/webhooks/stripe`. The event list to subscribe to
 * is in docs/going-live.md.
 *
 * ⚠️ Register the PRODUCTION url. Vercel's deployment protection puts a login
 * page in front of preview deployments, so events sent to a preview bounce off
 * it — and an order whose `payment_intent.succeeded` never arrived sits unpaid
 * with the customer's money already taken.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Fails closed, exactly as /api/cron/advance-orders does without
    // CRON_SECRET. An endpoint that mutates orders and payments is not
    // something to leave unauthenticated because an env var was forgotten.
    return Response.json(
      { error: "This endpoint is not configured" },
      { status: 403 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Unsigned" }, { status: 400 });

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(raw, signature, secret);
  } catch (e) {
    // Nothing from the payload is logged here — it failed verification, so
    // none of it is trustworthy enough to write down.
    console.error(
      "[stripe] signature verification failed:",
      e instanceof Error ? e.message : "unknown"
    );
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const claim = await claimEvent({
    id: event.id,
    type: event.type,
    eventAt: new Date(event.created * 1000).toISOString(),
    apiVersion: event.api_version ?? "",
    payload: event,
  });

  // Already done, or given up on. Either way Stripe should stop resending.
  if (claim.claim === "duplicate" || claim.claim === "exhausted") {
    return Response.json({ received: true, claim: claim.claim });
  }

  // Somebody else is mid-flight on this exact event. 500 so Stripe brings it
  // back later rather than us processing it twice in parallel.
  if (claim.claim === "in_flight") {
    return Response.json({ error: "Already processing" }, { status: 500 });
  }

  try {
    const result = await handleStripeEvent(event);

    if (result.handled) {
      await markProcessed(event.id);
      return Response.json({ received: true, effect: result.effect });
    }

    // A business-level "no": an unhandled type, a subject we can't resolve, an
    // event superseded by a newer one, a transition that isn't legal. None of
    // these become possible on a retry, and answering 500 would buy a
    // three-day redelivery storm on an event that will be refused identically
    // every time.
    await markSkipped(event.id, result.reason);
    return Response.json({ received: true, skipped: result.reason });
  } catch (e) {
    // A genuine failure — the database was unreachable, something threw. This
    // one *should* come back.
    const message = e instanceof Error ? e.message : "unknown error";
    console.error("[stripe] handler failed for", event.id, message);
    await markFailed(event.id, message);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
}
