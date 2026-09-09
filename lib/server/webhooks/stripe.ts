/**
 * Turning Stripe events into changes in this application.
 *
 * Two rules govern every branch here, and both are about what status code the
 * route returns rather than what the database ends up saying:
 *
 *  1. **A business-level "no" is a 200.** An event that asks for something
 *     impossible — a transition that isn't legal, a subject we can't resolve, a
 *     type we don't handle — will never become possible. Answering 500 buys a
 *     three-day retry storm on an event that is going to be refused identically
 *     every time.
 *  2. **A transient failure is a 500**, so Stripe redelivers.
 *
 * Everything is keyed on `event.created`, never arrival order.
 */

import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { applyIntentState, settleRefund } from "../payments/ledger";
import { settleOrderPayment, updateOrderStatus } from "../orders";
import { createPaymentRow } from "../payments/ledger";
import {
  applySubscriptionSnapshot,
  findUserForCustomer,
  getPlanByPriceId,
} from "../subscriptions";
import { notify } from "../notifications";
import { nowIso } from "../ids";
import type { PaymentIntentStatus } from "../payments";
import type { SubscriptionStatus } from "@/types";

/** Why an event produced no change. Every one of these answers 200. */
export type SkipReason =
  | "unknown_type"
  | "unknown_subject"
  | "stale"
  | "noop_transition";

export type HandleResult =
  | { handled: true; effect: string }
  | { handled: false; reason: SkipReason };

const skip = (reason: SkipReason): HandleResult => ({ handled: false, reason });

/** Unix seconds → the ISO strings this codebase stores. */
function iso(seconds: number | null | undefined): string {
  return new Date((seconds ?? 0) * 1000).toISOString();
}

function intentStatus(pi: Stripe.PaymentIntent): PaymentIntentStatus {
  switch (pi.status) {
    case "requires_payment_method":
      return "requires_payment_method";
    case "requires_action":
    case "requires_confirmation":
      return "requires_action";
    case "processing":
      return "processing";
    case "requires_capture":
      return "authorized";
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    default:
      return "failed";
  }
}

function cardOf(pi: Stripe.PaymentIntent) {
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") return {};
  const card = charge.payment_method_details?.card;
  return card
    ? { methodBrand: card.brand ?? undefined, methodLast4: card.last4 ?? undefined }
    : {};
}

export async function handleStripeEvent(
  event: Stripe.Event,
  db: PrismaClient = defaultPrisma
): Promise<HandleResult> {
  const eventAt = iso(event.created);

  switch (event.type) {
    /* ── One-off store payments ──────────────────────────────────── */

    case "payment_intent.succeeded":
    case "payment_intent.payment_failed":
    case "payment_intent.processing":
    case "payment_intent.requires_action":
    case "payment_intent.canceled": {
      const pi = event.data.object as Stripe.PaymentIntent;

      const applied = await applyIntentState(
        {
          ref: pi.id,
          // `payment_intent.payment_failed` arrives carrying an intent whose
          // status has *already* reverted to `requires_payment_method`, because
          // Stripe keeps it retryable. Reading the status off the object would
          // therefore record a decline as "pending" and lose the failure code
          // entirely. The event type is the authority on what happened; the
          // object is only the authority on what is true now.
          status:
            event.type === "payment_intent.payment_failed"
              ? "failed"
              : intentStatus(pi),
          amountCents: pi.amount,
          currency: pi.currency,
          clientSecret: null,
          failureCode: pi.last_payment_error?.code ?? undefined,
          failureMessage: pi.last_payment_error?.message ?? undefined,
          ...cardOf(pi),
        },
        { eventAt },
        db
      );

      if (!applied.ok) {
        if (applied.code === "unknown_payment") return skip("unknown_subject");
        if (applied.code === "stale_event") return skip("stale");
        // An illegal transition or an amount mismatch is recorded on the
        // payment row and is not going to resolve itself on a retry.
        return skip("noop_transition");
      }

      const orderId = pi.metadata?.orderId;
      if (!orderId) return { handled: true, effect: `payment ${applied.status}` };

      if (applied.status === "paid") {
        await settleOrderPayment(orderId, db);
        return { handled: true, effect: `order ${orderId} paid` };
      }

      if (applied.status === "failed" && event.type === "payment_intent.canceled") {
        // Cancelled outright: give the stock back.
        await updateOrderStatus(orderId, "cancelled", {}, db);
        return { handled: true, effect: `order ${orderId} cancelled` };
      }

      if (applied.status === "failed") {
        // A decline, not a cancellation. Stripe keeps the intent retryable, so
        // the order stays where it is and the customer is told to try again.
        const order = await db.order.findUnique({
          where: { id: orderId },
          select: { userId: true },
        });
        if (order) {
          await notify(
            order.userId,
            {
              kind: "order_payment_failed",
              title: "Your payment didn't go through",
              body: "Your order is held for a short while — you can try a different card.",
              href: `/store/orders/${orderId}`,
            },
            db
          );
        }
        return { handled: true, effect: `order ${orderId} payment failed` };
      }

      return { handled: true, effect: `payment ${applied.status}` };
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentRef =
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
      if (!intentRef) return skip("unknown_subject");

      const payment = await db.payment.findUnique({
        where: { providerRef: intentRef },
      });
      if (!payment) return skip("unknown_subject");

      // Reconcile every refund Stripe knows about against our own rows. This is
      // what makes a refund issued from the Stripe dashboard — which is how
      // finance staff will often do it — flow back into the app.
      for (const r of charge.refunds?.data ?? []) {
        const existing = await db.refund.findUnique({ where: { providerRef: r.id } });
        if (existing) {
          if (r.status === "succeeded" && existing.status !== "succeeded") {
            await settleRefund(existing.id, db);
          }
          continue;
        }
        const created = await db.refund.create({
          data: {
            id: `rfnd_${r.id}`,
            paymentId: payment.id,
            providerRef: r.id,
            amountCents: r.amount,
            status: r.status === "succeeded" ? "succeeded" : "pending",
            reason: r.reason ?? "",
            initiatedBy: "stripe",
            note: "Recorded from a provider event",
            createdAt: iso(r.created),
          },
        });
        if (r.status === "succeeded") await settleRefund(created.id, db);
      }

      const after = await db.payment.findUnique({ where: { id: payment.id } });
      if (after?.status === "refunded" && after.orderId) {
        const order = await db.order.findUnique({
          where: { id: after.orderId },
          select: { status: true },
        });
        if (order && order.status !== "refunded" && order.status !== "cancelled") {
          await updateOrderStatus(after.orderId, "refunded", {}, db);
        }
      }
      return { handled: true, effect: `refunds reconciled for ${intentRef}` };
    }

    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const intentRef =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      if (!intentRef) return skip("unknown_subject");

      const payment = await db.payment.findUnique({ where: { providerRef: intentRef } });
      if (!payment) return skip("unknown_subject");

      await db.payment.update({
        where: { id: payment.id },
        data: { status: "disputed", lastEventAt: eventAt, updatedAt: nowIso() },
      });
      return { handled: true, effect: `payment ${payment.id} disputed` };
    }

    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const intentRef =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
      if (!intentRef) return skip("unknown_subject");

      const payment = await db.payment.findUnique({ where: { providerRef: intentRef } });
      if (!payment) return skip("unknown_subject");

      const won = dispute.status === "won";
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: won ? "paid" : "refunded",
          amountRefundedCents: won ? payment.amountRefundedCents : payment.amountCents,
          lastEventAt: eventAt,
          updatedAt: nowIso(),
        },
      });
      return { handled: true, effect: `dispute ${dispute.status}` };
    }

    /* ── Membership ──────────────────────────────────────────────── */

    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return skip("unknown_type");

      const userId = session.client_reference_id;
      const customerRef =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (!userId || !customerRef) return skip("unknown_subject");

      // Remember the customer, so a returning member is not billed as a
      // stranger and the Billing Portal can be opened for them later.
      await db.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerRef },
      });
      // The subscription itself arrives on customer.subscription.created; this
      // event only establishes who the customer is.
      return { handled: true, effect: `customer ${customerRef} linked to ${userId}` };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerRef =
        typeof sub.customer === "string" ? sub.customer : sub.customer.id;

      const userId =
        sub.metadata?.userId ?? (await findUserForCustomer(customerRef, db));
      if (!userId) return skip("unknown_subject");

      const priceId = sub.items.data[0]?.price?.id ?? "";
      const plan = await getPlanByPriceId(priceId, db);
      if (!plan) return skip("unknown_subject");

      const item = sub.items.data[0];
      const result = await applySubscriptionSnapshot(
        {
          providerRef: sub.id,
          providerCustomerId: customerRef,
          status:
            event.type === "customer.subscription.deleted"
              ? "canceled"
              : (sub.status as SubscriptionStatus),
          currentPeriodStart: iso(item?.current_period_start),
          currentPeriodEnd: iso(item?.current_period_end),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          canceledAt: sub.canceled_at ? iso(sub.canceled_at) : null,
          endedAt: sub.ended_at ? iso(sub.ended_at) : null,
          latestInvoiceRef:
            typeof sub.latest_invoice === "string"
              ? sub.latest_invoice
              : (sub.latest_invoice?.id ?? ""),
          planId: plan.id,
          userId,
        },
        eventAt,
        db
      );

      if (!result.ok) {
        return skip(result.code === "stale" ? "stale" : "unknown_subject");
      }
      return { handled: true, effect: `subscription ${sub.id} → ${sub.status}` };
    }

    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerRef =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const userId = await findUserForCustomer(customerRef ?? "", db);
      if (!userId || !invoice.id) return skip("unknown_subject");

      // A ledger row per renewal, so the finance console can show a member's
      // billing history without querying Stripe.
      const existing = await db.payment.findUnique({
        where: { providerRef: invoice.id },
      });
      if (!existing) {
        await createPaymentRow(
          {
            userId,
            kind: "subscription_invoice",
            provider: "stripe",
            providerRef: invoice.id,
            providerCustomerId: customerRef ?? "",
            amountCents: invoice.amount_paid,
            currency: invoice.currency,
            status: "paid",
          },
          db
        );
      }
      // No notification: nobody wants a monthly "we charged you" in their bell,
      // and Stripe emails the receipt.
      return { handled: true, effect: `invoice ${invoice.id} recorded` };
    }

    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerRef =
        typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const userId = await findUserForCustomer(customerRef ?? "", db);
      if (!userId) return skip("unknown_subject");

      // The status change itself arrives on customer.subscription.updated,
      // which is also where the dunning notification is sent from — so this
      // branch only has to say something when the bank wants the customer to
      // act, which no subscription event conveys.
      if (event.type === "invoice.payment_action_required") {
        await notify(
          userId,
          {
            kind: "membership_payment_failed",
            title: "Your bank needs to confirm your membership payment",
            body: "Open your billing settings to approve it.",
            href: "/account/membership",
          },
          db
        );
      }
      return { handled: true, effect: `invoice trouble for ${userId}` };
    }

    default:
      // Stripe endpoints receive types nobody subscribed to. Not an error.
      return skip("unknown_type");
  }
}
