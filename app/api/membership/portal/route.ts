import { error, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { appOrigin } from "@/lib/server/origin";
import { subscriptionProvider } from "@/lib/server/payments/subscription-provider";

// POST /api/membership/portal -> { url }
//
// The provider's own billing portal: card updates, invoice history, receipts.
// Deliberately not rebuilt here — every one of those screens is somewhere for
// card data to end up, and there is no version of us handling it that is safer
// than not handling it.
export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const provider = subscriptionProvider();
  if (!provider) return error("Billing management isn't available just now", 503);

  const user = await prisma.user.findUnique({
    where: { id: auth.uid },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    return error("You don't have any billing history yet", 409);
  }

  try {
    const { url } = await provider.portalUrl({
      customerRef: user.stripeCustomerId,
      returnUrl: `${appOrigin()}/account/membership`,
    });
    return ok({ url });
  } catch (e) {
    console.error("[membership] portal failed", e);
    return error("We couldn't open that. Please try again.", 502);
  }
}
