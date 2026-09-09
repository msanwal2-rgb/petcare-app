import { error, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { getSubscriptionForUser } from "@/lib/server/subscriptions";
import { subscriptionProvider } from "@/lib/server/payments/subscription-provider";
import { notify } from "@/lib/server/notifications";
import { nowIso } from "@/lib/server/ids";

// POST /api/membership/cancel -> { ok }
//
// Cancels at the end of the period the customer has already paid for, rather
// than immediately — they bought the month, they keep the month.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const sub = await getSubscriptionForUser(auth.uid);
  if (!sub || !["trialing", "active", "past_due"].includes(sub.status)) {
    return error("You don't have an active membership", 409);
  }

  const provider = subscriptionProvider();
  if (provider) {
    try {
      await provider.setCancelAtPeriodEnd(sub.providerRef, true);
    } catch (e) {
      console.error("[membership] cancel failed", e);
      return error("We couldn't cancel that. Please try again.", 502);
    }
  }

  // Set locally too. The webhook will confirm it, but the customer clicked
  // cancel and should see it reflected without waiting for a round trip.
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: true, updatedAt: nowIso() },
  });

  await notify(auth.uid, {
    kind: "membership_cancelled",
    title: "Your membership will end",
    body: `Leash Plus stays active until ${sub.currentPeriodEnd.slice(0, 10)}. You can change your mind before then.`,
    href: "/account/membership",
  });

  return ok({ ok: true, endsAt: sub.currentPeriodEnd });
}
