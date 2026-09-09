/**
 * The payments ledger: the one place `paymentStatus` is written.
 *
 * `applyIntentState` is the reconciler, and it has exactly three callers —
 * the Stripe webhook, the inline settle the demo provider takes, and the
 * client-initiated sync a confirmation page uses when a webhook is slow. One
 * function for all three is the point: the demo path and the real path cannot
 * drift, because there is only one path.
 *
 * It is idempotent. Applying the same provider state twice is a no-op, which is
 * what makes webhook replay safe, and what lets the sync endpoint be called as
 * often as an impatient page wants to call it.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db/prisma";
import { genId, nowIso } from "../ids";
import {
  canTransitionPayment,
  paymentProvider,
  paymentStatusForIntent,
  type PaymentIntentRecord,
  type RefundReason,
} from "../payments";
import type { PaymentStatus } from "@/types";

export interface PaymentRow {
  id: string;
  userId: string;
  kind: string;
  orderId: string | null;
  subscriptionId: string | null;
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  createdAt: string;
}

/** Statuses that mean "this attempt is over and did not work". */
const DEAD = ["failed"] as const;

/**
 * The order's live payment: the newest row that has not failed.
 *
 * Not a unique index on `orderId`, because a customer whose first intent is
 * cancelled must be able to try again, and the abandoned intent is part of the
 * record rather than something to overwrite.
 */
export async function currentPaymentForOrder(
  orderId: string,
  db: PrismaClient = defaultPrisma
) {
  return db.payment.findFirst({
    where: { orderId, status: { notIn: [...DEAD] } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createPaymentRow(
  input: {
    userId: string;
    kind: "order" | "subscription_invoice" | "adoption_fee";
    orderId?: string;
    subscriptionId?: string;
    adoptionApplicationId?: string;
    provider: string;
    providerRef: string;
    providerCustomerId?: string;
    amountCents: number;
    currency?: string;
    status?: PaymentStatus;
  },
  db: PrismaClient | Prisma.TransactionClient = defaultPrisma
) {
  const now = nowIso();
  return db.payment.create({
    data: {
      id: genId("pay"),
      userId: input.userId,
      kind: input.kind,
      orderId: input.orderId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      adoptionApplicationId: input.adoptionApplicationId ?? null,
      provider: input.provider,
      providerRef: input.providerRef,
      providerCustomerId: input.providerCustomerId ?? "",
      status: input.status ?? "unpaid",
      amountCents: input.amountCents,
      currency: input.currency ?? "usd",
      createdAt: now,
      updatedAt: now,
    },
  });
}

export type ApplyResult =
  | { ok: true; status: PaymentStatus; changed: boolean }
  | { ok: false; code: "unknown_payment" }
  | { ok: false; code: "stale_event" }
  | { ok: false; code: "illegal_transition"; from: PaymentStatus; to: PaymentStatus }
  | { ok: false; code: "amount_mismatch"; expected: number; actual: number };

/**
 * Fold a provider intent state into the ledger.
 *
 * `eventAt` is the provider event's own timestamp, not arrival time. Webhooks
 * arrive out of order, and last-writer-wins is only correct if "last" means
 * "most recently *created*" — otherwise a delayed failure notice can overwrite
 * a later success.
 *
 * The amount is re-checked against what we recorded. If they disagree, the
 * payment is not marked paid: either the order was re-priced under us or the
 * intent is not the one we think it is, and both are worth a human looking.
 */
export async function applyIntentState(
  intent: PaymentIntentRecord,
  opts: { eventAt?: string } = {},
  db: PrismaClient = defaultPrisma
): Promise<ApplyResult> {
  const payment = await db.payment.findUnique({
    where: { providerRef: intent.ref },
  });
  if (!payment) return { ok: false, code: "unknown_payment" };

  const eventAt = opts.eventAt ?? nowIso();
  if (payment.lastEventAt && eventAt < payment.lastEventAt) {
    return { ok: false, code: "stale_event" };
  }

  const from = payment.status as PaymentStatus;
  const to = paymentStatusForIntent(intent.status);

  if (from === to) {
    // Already there. Still record that we have seen this event, so a genuinely
    // older one arriving afterwards is recognised as stale.
    await db.payment.update({
      where: { id: payment.id },
      data: { lastEventAt: eventAt },
    });
    return { ok: true, status: to, changed: false };
  }

  if (!canTransitionPayment(from, to)) {
    return { ok: false, code: "illegal_transition", from, to };
  }

  if (
    to === "paid" &&
    intent.amountCents > 0 &&
    intent.amountCents !== payment.amountCents
  ) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: "failed",
        failureCode: "amount_mismatch",
        failureMessage: `Provider charged ${intent.amountCents}, order expected ${payment.amountCents}`,
        lastEventAt: eventAt,
        updatedAt: nowIso(),
      },
    });
    return {
      ok: false,
      code: "amount_mismatch",
      expected: payment.amountCents,
      actual: intent.amountCents,
    };
  }

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: to,
      failureCode: intent.failureCode ?? "",
      failureMessage: intent.failureMessage ?? "",
      ...(intent.methodBrand ? { methodBrand: intent.methodBrand } : {}),
      ...(intent.methodLast4 ? { methodLast4: intent.methodLast4 } : {}),
      ...(to === "paid" ? { succeededAt: nowIso() } : {}),
      lastEventAt: eventAt,
      updatedAt: nowIso(),
    },
  });

  return { ok: true, status: to, changed: true };
}

/* ── Refunds ───────────────────────────────────────────────────── */

export type RefundResult =
  | { ok: true; refundId: string; amountCents: number }
  | { ok: false; code: "no_payment" }
  | { ok: false; code: "not_refundable"; status: PaymentStatus }
  | { ok: false; code: "already_refunding" }
  | { ok: false; code: "exceeds_captured"; remainingCents: number }
  | { ok: false; code: "provider_failed"; message: string };

/** How much of a payment could still be sent back. */
export function refundableCents(payment: {
  amountCents: number;
  amountRefundedCents: number;
}): number {
  return Math.max(0, payment.amountCents - payment.amountRefundedCents);
}

/**
 * Send money back.
 *
 * The `Refund` row is written at "pending" **before** the provider is called.
 * That ordering is the whole point: a crash between the write and the call
 * leaves a pending row a sweep can retry, whereas the previous code called the
 * provider after committing an order to `refunded` — and since `refunded` is
 * terminal, a provider failure there stranded the money with no way to try
 * again through any supported path.
 */
export async function requestRefund(
  input: {
    orderId?: string;
    paymentId?: string;
    amountCents?: number;
    reason?: RefundReason;
    /** A staff user id, or "system" when a cancellation triggered it. */
    initiatedBy?: string;
    note?: string;
  },
  db: PrismaClient = defaultPrisma
): Promise<RefundResult> {
  const payment = input.paymentId
    ? await db.payment.findUnique({ where: { id: input.paymentId } })
    : input.orderId
      ? await currentPaymentForOrder(input.orderId, db)
      : null;

  if (!payment) return { ok: false, code: "no_payment" };

  const status = payment.status as PaymentStatus;
  if (!["paid", "partially_refunded", "authorized", "disputed"].includes(status)) {
    return { ok: false, code: "not_refundable", status };
  }

  const inFlight = await db.refund.findFirst({
    where: { paymentId: payment.id, status: "pending" },
  });
  if (inFlight) return { ok: false, code: "already_refunding" };

  const remaining = refundableCents(payment);
  const amount = input.amountCents ?? remaining;
  if (amount <= 0 || amount > remaining) {
    return { ok: false, code: "exceeds_captured", remainingCents: remaining };
  }

  const refund = await db.refund.create({
    data: {
      id: genId("rfnd"),
      paymentId: payment.id,
      amountCents: amount,
      status: "pending",
      reason: input.reason ?? "requested_by_customer",
      initiatedBy: input.initiatedBy ?? "system",
      note: input.note ?? "",
      createdAt: nowIso(),
    },
  });

  try {
    const result = await paymentProvider().refund({
      ref: payment.providerRef,
      amountCents: amount,
      reason: input.reason,
      idempotencyKey: refund.id,
    });

    // Note what is *not* set here: `settledAt`. That is `settleRefund`'s to
    // write, and it is also how it knows an amount has already been folded into
    // the payment's total — setting it here made every refund look
    // already-counted, so the total never moved.
    await db.refund.update({
      where: { id: refund.id },
      data: { providerRef: result.ref, status: result.status },
    });

    // A provider that settles synchronously (the demo) is done here. A real one
    // reports "pending" and the `charge.refunded` webhook finishes the job, so
    // the totals below are applied in exactly one place either way.
    if (result.status === "succeeded") {
      await settleRefund(refund.id, db);
    }

    return { ok: true, refundId: refund.id, amountCents: amount };
  } catch (e) {
    await db.refund.update({
      where: { id: refund.id },
      data: { status: "failed", note: e instanceof Error ? e.message : "" },
    });
    return {
      ok: false,
      code: "provider_failed",
      message: e instanceof Error ? e.message : "The provider refused the refund",
    };
  }
}

/**
 * Mark a refund settled and move the payment's totals.
 *
 * Called by `requestRefund` for a synchronous provider and by the
 * `charge.refunded` webhook for a real one — including when a refund was issued
 * from the Stripe dashboard rather than from here, which is how finance staff
 * will often do it.
 */
export async function settleRefund(
  refundId: string,
  db: PrismaClient = defaultPrisma
): Promise<void> {
  const refund = await db.refund.findUnique({
    where: { id: refundId },
    include: { payment: true },
  });
  if (!refund) return;

  const alreadyCounted = refund.settledAt !== null && refund.status === "succeeded";
  const refunded =
    refund.payment.amountRefundedCents + (alreadyCounted ? 0 : refund.amountCents);
  const fully = refunded >= refund.payment.amountCents;
  const next: PaymentStatus = fully ? "refunded" : "partially_refunded";
  const from = refund.payment.status as PaymentStatus;

  await db.$transaction([
    db.refund.update({
      where: { id: refundId },
      data: { status: "succeeded", settledAt: refund.settledAt ?? nowIso() },
    }),
    db.payment.update({
      where: { id: refund.paymentId },
      data: {
        amountRefundedCents: Math.min(refunded, refund.payment.amountCents),
        ...(canTransitionPayment(from, next) ? { status: next } : {}),
        updatedAt: nowIso(),
      },
    }),
    // Keep the order's own `paymentStatus` in step with the ledger.
    //
    // It is a denormalised copy — the ledger is the record, and this is what the
    // customer's order page and the fulfilment queue read. Updating it here,
    // inside the same transaction, is what stops the two disagreeing: the order
    // saying "paid" while the money has gone back is exactly the kind of drift
    // that makes a support call unanswerable.
    ...(refund.payment.orderId
      ? [
          db.order.update({
            where: { id: refund.payment.orderId },
            data: { paymentStatus: next },
          }),
        ]
      : []),
  ]);
}
