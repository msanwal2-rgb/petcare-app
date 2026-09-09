import { error, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { appOrigin } from "@/lib/server/origin";
import { getMembership } from "@/lib/server/entitlements";
import { getPlanByKey } from "@/lib/server/subscriptions";
import { subscriptionProvider } from "@/lib/server/payments/subscription-provider";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";
import { PLAN_KEY } from "../route";

// POST /api/membership/checkout -> { url }
//
// Hands the customer to the provider's hosted checkout rather than collecting a
// card here. That brings SCA, 3-D Secure, tax handling and promotion codes for
// free, and — with the Billing Portal — removes an entire admin surface for
// card updates and invoice history.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const limited = await limit(RATE_LIMITS.checkout, `uid:${auth.uid}`);
  if (limited) return limited;

  const provider = subscriptionProvider();
  const plan = await getPlanByKey(PLAN_KEY);

  // Fails closed rather than pretending. Without a configured provider, or a
  // price that exists in it, "subscribe" would sign somebody up to nothing.
  if (!provider || !plan?.purchasable) {
    return error("Memberships aren't available just now", 503);
  }

  const existing = await getMembership(auth.uid);
  if (existing.active) return error("You're already a member", 409);

  const user = await prisma.user.findUnique({
    where: { id: auth.uid },
    select: { email: true, name: true, stripeCustomerId: true },
  });
  if (!user) return error("Account not found", 404);

  try {
    let customerRef = user.stripeCustomerId;
    if (!customerRef) {
      customerRef = await provider.ensureCustomer({
        userId: auth.uid,
        email: user.email,
        name: user.name,
      });
      await prisma.user.update({
        where: { id: auth.uid },
        data: { stripeCustomerId: customerRef },
      });
    }

    const origin = appOrigin();
    const { url } = await provider.startCheckout({
      customerRef,
      priceId: (await prisma.plan.findUnique({ where: { key: PLAN_KEY } }))!
        .stripePriceId,
      userId: auth.uid,
      // The redirect back is not the truth — the webhook is. The success page
      // polls until the subscription row appears.
      successUrl: `${origin}/account/membership?checkout=success`,
      cancelUrl: `${origin}/plus?checkout=cancelled`,
    });
    return ok({ url });
  } catch (e) {
    console.error("[membership] checkout failed", e);
    return error("We couldn't start that. Please try again.", 502);
  }
}
