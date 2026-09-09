import { ok, error } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { getMembership } from "@/lib/server/entitlements";
import {
  applySubscriptionSnapshot,
  getPlanByPriceId,
  getSubscriptionForUser,
} from "@/lib/server/subscriptions";
import { subscriptionProvider } from "@/lib/server/payments/subscription-provider";
import { nowIso } from "@/lib/server/ids";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import type { SubscriptionStatus } from "@/types";

// POST /api/membership/sync -> Membership
//
// The escape hatch for a webhook that is slow or lost. The membership page
// calls it after a checkout redirect, and it is safe to call repeatedly: it
// pulls the provider's current state through exactly the same reconciler the
// webhook uses, so there is no second code path to keep in step.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // Throttled: this reaches the payment provider, and the membership page polls
  // it while a checkout settles.
  const limited = await limit(RATE_LIMITS.providerSync, `uid:${auth.uid}`);
  if (limited) return limited;

  const provider = subscriptionProvider();
  const sub = await getSubscriptionForUser(auth.uid);

  if (provider && sub) {
    try {
      const snapshot = await provider.getSubscription(sub.providerRef);
      const plan = await getPlanByPriceId(snapshot.priceId);
      if (plan) {
        await applySubscriptionSnapshot(
          {
            providerRef: snapshot.ref,
            providerCustomerId: snapshot.customerRef,
            status: snapshot.status as SubscriptionStatus,
            currentPeriodStart: snapshot.currentPeriodStart,
            currentPeriodEnd: snapshot.currentPeriodEnd,
            cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
            planId: plan.id,
            userId: auth.uid,
          },
          nowIso(),
          prisma
        );
      }
    } catch (e) {
      console.error("[membership] sync failed", e);
      return error("We couldn't refresh that just now", 502);
    }
  }

  return ok(await getMembership(auth.uid));
}
