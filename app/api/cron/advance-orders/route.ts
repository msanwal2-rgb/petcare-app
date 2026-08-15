import { advanceDueOrders } from "@/lib/server/fulfillment";
import { forbidden, ok } from "@/lib/server/http";

/**
 * GET /api/cron/advance-orders
 *
 * Moves in-flight orders to the stage their age has earned. Vercel Cron calls
 * this with `Authorization: Bearer $CRON_SECRET` on the schedule in
 * vercel.json — daily, because Hobby permits only one firing a day. That is
 * survivable precisely because the job is time-based rather than
 * step-per-run: see lib/server/fulfillment.ts. On Pro, tightening the
 * schedule needs no code change.
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
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return forbidden("This endpoint is for the scheduler");
  }
  const report = await advanceDueOrders();
  return ok(report);
}
