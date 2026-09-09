/**
 * The adoption fee.
 *
 * Mirrors `createOrder`'s payment step, and reuses the ledger wholesale. Worth
 * noting what did *not* need writing: `applyIntentState` keys on `providerRef`,
 * so the reconciler that settles a store order settles an adoption fee with no
 * new code, and the Stripe webhook needed no new branch either.
 *
 * Money moves when the payer acts. This endpoint is the applicant's; completing
 * the adoption is the shelter's.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { nowIso } from "../ids";
import { paymentProvider } from "../payments";
import { applyIntentState, createPaymentRow, requestRefund } from "../payments/ledger";
import type { ApplicationStatus, PaymentStatus } from "@/types";

export type StartAdoptionPaymentResult =
  | {
      ok: true;
      payment: { ref: string; clientSecret: string | null; provider: string };
      status: PaymentStatus;
    }
  | { ok: false; code: "not_found" }
  | { ok: false; code: "not_applicant" }
  | { ok: false; code: "not_approved"; status: ApplicationStatus }
  | { ok: false; code: "no_fee" }
  | { ok: false; code: "already_paid" }
  | { ok: false; code: "payment_setup_failed"; message: string };

export async function startAdoptionPayment(
  applicationId: string,
  actorUserId: string,
  db: PrismaClient = defaultPrisma
): Promise<StartAdoptionPaymentResult> {
  const application = await db.adoptionApplication.findUnique({
    where: { id: applicationId },
  });
  if (!application) return { ok: false, code: "not_found" };
  if (application.applicantId !== actorUserId) {
    return { ok: false, code: "not_applicant" };
  }

  const status = application.status as ApplicationStatus;
  // Nobody pays before they are approved. That ordering is what makes a
  // co-applicant refund impossible: only one person is ever asked for money.
  if (status !== "approved") return { ok: false, code: "not_approved", status };

  // Plenty of shelters waive the fee. Don't mint a zero-value intent for them —
  // the demo provider throws on it and Stripe would reject it below its
  // minimum. A waived fee simply has no payment row.
  if (application.feeCents <= 0) return { ok: false, code: "no_fee" };

  const existing = await db.payment.findUnique({
    where: { adoptionApplicationId: applicationId },
  });
  if (existing) {
    if (existing.status === "paid") return { ok: false, code: "already_paid" };
    // An intent that exists but has not settled is retryable — hand the same
    // one back rather than creating a second charge for one animal.
    return {
      ok: true,
      payment: {
        ref: existing.providerRef,
        clientSecret: null,
        provider: existing.provider,
      },
      status: existing.status as PaymentStatus,
    };
  }

  const provider = paymentProvider();
  try {
    const customerRef = await db.user
      .findUnique({
        where: { id: actorUserId },
        select: { stripeCustomerId: true },
      })
      .then((u) => u?.stripeCustomerId ?? null);

    const intent = await provider.createIntent({
      amountCents: application.feeCents,
      currency: "usd",
      // The ledger's order-shaped metadata; an adoption has no order, and the
      // application id is what the webhook resolves back to.
      orderId: applicationId,
      userId: actorUserId,
      idempotencyKey: applicationId,
      customerRef,
    });

    await createPaymentRow(
      {
        userId: actorUserId,
        kind: "adoption_fee",
        adoptionApplicationId: applicationId,
        provider: provider.name,
        providerRef: intent.ref,
        providerCustomerId: customerRef ?? "",
        amountCents: application.feeCents,
        currency: intent.currency,
      },
      db
    );

    // A synchronous provider has already settled; the same reconciler the
    // webhook uses folds it in, so there is one path rather than two.
    if (!provider.asynchronous) {
      await applyIntentState(intent, { eventAt: nowIso() }, db);
    }

    const fresh = await db.payment.findUnique({
      where: { adoptionApplicationId: applicationId },
    });

    return {
      ok: true,
      payment: {
        ref: intent.ref,
        clientSecret: intent.clientSecret,
        provider: provider.name,
      },
      status: (fresh?.status as PaymentStatus) ?? "pending",
    };
  } catch (e) {
    return {
      ok: false,
      code: "payment_setup_failed",
      message: e instanceof Error ? e.message : "Could not start the payment",
    };
  }
}

/**
 * Send an adoption fee back.
 *
 * Called when an approved applicant is rejected or withdraws after paying.
 * Deliberately *not* called when an adoption is reversed after completion —
 * that is a staff decision with its own conversation, and auto-refunding it
 * here would make a returned animal quietly free.
 */
export async function refundAdoptionFee(
  applicationId: string,
  initiatedBy: string,
  note: string,
  db: PrismaClient = defaultPrisma
) {
  const payment = await db.payment.findUnique({
    where: { adoptionApplicationId: applicationId },
  });
  if (!payment || payment.status !== "paid") return null;

  return requestRefund(
    {
      paymentId: payment.id,
      reason: "requested_by_customer",
      initiatedBy,
      note,
    },
    db
  );
}
