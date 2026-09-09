import { error, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { getSubscriptionForUser } from "@/lib/server/subscriptions";
import { subscriptionProvider } from "@/lib/server/payments/subscription-provider";
import { nowIso } from "@/lib/server/ids";

// POST /api/membership/resume -> { ok }
//
// Undo a cancellation that hasn't taken effect yet. Only meaningful before the
// period ends; afterwards the subscription is gone and rejoining is a fresh
// checkout.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const sub = await getSubscriptionForUser(auth.uid);
  if (!sub || !sub.cancelAtPeriodEnd) {
    return error("There's no scheduled cancellation to undo", 409);
  }

  const provider = subscriptionProvider();
  if (provider) {
    try {
      await provider.setCancelAtPeriodEnd(sub.providerRef, false);
    } catch (e) {
      console.error("[membership] resume failed", e);
      return error("We couldn't do that. Please try again.", 502);
    }
  }

  await prisma.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: false, updatedAt: nowIso() },
  });
  return ok({ ok: true });
}
