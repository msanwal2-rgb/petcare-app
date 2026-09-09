import { timingSafeEqual } from "crypto";
import { advanceDueOrders } from "@/lib/server/fulfillment";
import { sweepAbandonedCheckouts } from "@/lib/server/reservations";
import { purgeExpired } from "@/lib/server/rate-limit";
import { purgeOldEvents } from "@/lib/server/webhooks/store";
import { forbidden, ok } from "@/lib/server/http";

/**
 * GET /api/cron/advance-orders
 *
 * Moves in-flight orders to the stage their age has earned, and does the
 * housekeeping that has no better home. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET` on the schedule in vercel.json — daily,
 * because Hobby permits only one firing a day. That is survivable precisely
 * because the job is time-based rather than step-per-run: see
 * lib/server/fulfillment.ts. On Pro, tightening the schedule needs no code
 * change.
 *
 * Note what is *not* here: reclaiming stock from abandoned checkouts. Holds
 * expire in fifteen minutes and a daily cron cannot enforce that, so the
 * reclaim happens inside `createOrder` instead — at the moment somebody else
 * actually wants the stock. The sweep below only tidies the *status* of those
 * orders so they stop sitting in a customer's list forever.
 *
 * GET rather than POST because that is what Vercel Cron sends. It is not
 * idempotent-by-accident either: `advanceDueOrders` computes the target stage
 * from elapsed time, so calling it twice changes nothing the second time.
 */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // With no secret configured the endpoint stays shut rather than open. An
  // unauthenticated endpoint that mutates orders is not a thing to leave lying
  // around because an environment variable was forgotten.
  if (!secret) return false;

  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  // Constant-time. A plain `===` on a secret leaks its prefix through timing,
  // and the fix costs two lines.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return forbidden("This endpoint is for the scheduler");
  }

  const now = new Date();
  const report = await advanceDueOrders(now);

  // Housekeeping. Each is independent and best-effort: a failure here must not
  // stop parcels moving, which is what this job is actually for.
  const housekeeping = { abandonedCheckouts: 0, rateLimitHits: 0, webhookEvents: 0 };
  try {
    housekeeping.abandonedCheckouts = (
      await sweepAbandonedCheckouts(now.toISOString())
    ).released;
  } catch (e) {
    console.error("[cron] abandoned-checkout sweep failed", e);
  }
  try {
    housekeeping.rateLimitHits = await purgeExpired(now);
  } catch (e) {
    console.error("[cron] rate-limit purge failed", e);
  }
  try {
    // Webhook payloads carry email addresses and card last-fours. There is no
    // reason to keep them once nobody is going to replay them.
    housekeeping.webhookEvents = await purgeOldEvents(now);
  } catch (e) {
    console.error("[cron] webhook purge failed", e);
  }

  return ok({ ...report, housekeeping });
}
