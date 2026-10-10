import type { OrderStatus } from "@/types";

/**
 * Order lifecycle facts the order page needs to decide what to show.
 *
 * A mirror of `Leash.Core/Services/Delivery.cs`. The server is the authority —
 * it refuses a cancellation outside the window with a 409 whatever this says —
 * so the only cost of drift is a Cancel button that leads to a polite refusal.
 * Keep the two in step anyway.
 */

/** Statuses a customer may still cancel from. Once it is with the carrier, the answer is a refund. */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = [
  "pending_payment",
  "paid",
  "processing",
  "packed",
];

export function canCustomerCancel(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE.includes(status);
}

/** The happy path, in order, starting from a settled payment. */
export const JOURNEY: OrderStatus[] = [
  "paid",
  "processing",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
];

/**
 * How long after being placed an order reaches each stage — the server's
 * `Delivery.Schedule`, which the fulfilment job walks. Read by the support
 * page, so the timings it quotes are the ones the job actually keeps.
 */
export const FULFILMENT_SCHEDULE: { status: OrderStatus; afterHours: number }[] = [
  { status: "processing", afterHours: 1 },
  { status: "packed", afterHours: 6 },
  { status: "shipped", afterHours: 24 },
  { status: "out_for_delivery", afterHours: 48 },
  { status: "delivered", afterHours: 60 },
];

/** Hours after placement at which cancellation stops being possible. */
export function hoursUntilUncancellable(): number {
  const firstUncancellable = FULFILMENT_SCHEDULE.find(
    (stage) => !CUSTOMER_CANCELLABLE.includes(stage.status),
  );
  return firstUncancellable?.afterHours ?? Infinity;
}
