import { error, notFound, ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { prisma } from "@/lib/db/prisma";
import { getOrderById, settleOrderPayment } from "@/lib/server/orders";
import { applyIntentState, currentPaymentForOrder } from "@/lib/server/payments/ledger";
import { paymentProvider } from "@/lib/server/payments";
import { nowIso } from "@/lib/server/ids";
import { RATE_LIMITS, limit } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/orders/:id/payment/sync -> Order
//
// The confirmation page calls this after the customer finishes paying, because
// the browser finding out is not the same as us finding out — the webhook is
// the truth, and it can be slow, blocked by deployment protection on a preview,
// or lost.
//
// It pulls the provider's current state through the *same* reconciler the
// webhook uses, so there is no second path to keep in step, and it is safe to
// call repeatedly: applying an already-applied state is a no-op.
export async function POST(_request: Request, ctx: Ctx) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // Throttled: this reaches the payment provider on every call.
  const limited = await limit(RATE_LIMITS.providerSync, `uid:${auth.uid}`);
  if (limited) return limited;

  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true },
  });
  if (!order) return notFound(`Order ${id} not found`);
  if (order.userId !== auth.uid) return notFound(`Order ${id} not found`);

  const payment = await currentPaymentForOrder(id);
  if (!payment) return error("This order has no payment to check", 409);

  try {
    const intent = await paymentProvider().getIntent(payment.providerRef);
    await applyIntentState(intent, { eventAt: nowIso() });
    await settleOrderPayment(id);
  } catch (e) {
    console.error("[payments] sync failed for", id, e);
    // Not fatal: the webhook may still land. Return whatever we do know.
  }

  const fresh = await getOrderById(id);
  return fresh ? ok(fresh) : notFound(`Order ${id} not found`);
}
