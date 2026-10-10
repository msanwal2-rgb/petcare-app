import type {
  CartLineInput,
  CartQuote,
  CreateOrderInput,
  Order,
  OrderStatus,
  PlacedOrder,
} from "@/types";
import { getJson, postJson, patchJson, qs } from "./_client";

/**
 * Checkout and orders — API client.
 *
 * ── Nothing here carries a price ──
 *
 * `quote` and `createOrder` send product ids and quantities. The server
 * re-reads the catalogue and computes every number (REQUIREMENTS.md S10); the
 * cart's figures are an estimate for the customer and nothing more.
 *
 * ── The three failures checkout must handle ──
 *
 * `createOrder` throws `ApiError` with structured `details`:
 *
 *  - **409 + `details.quote`** — the basket cannot be sold as it stands. The
 *    quote's `problems` say which lines and why; show them, don't retry.
 *  - **409 + `details.productId`** — somebody bought the last one between the
 *    quote and the purchase. Re-quote and let the customer adjust.
 *  - **502 + `details.orderId`** — the order exists and holds its stock; only
 *    starting the payment failed. Retry `syncPayment(orderId)`, **not** the
 *    whole cart — a second `createOrder` would reserve the stock twice.
 */

export interface OrderPage {
  items: Order[];
  nextCursor: string | null;
}

/** POST /orders/quote -> the server's price for this basket. Signed-in only. */
export function quote(items: CartLineInput[], petId?: string | null): Promise<CartQuote> {
  return postJson<CartQuote>("/orders/quote", { items, petId: petId ?? null });
}

/** POST /orders -> the placed order with its payment handoff (201). */
export function createOrder(input: CreateOrderInput): Promise<PlacedOrder> {
  return postJson<PlacedOrder>("/orders", input);
}

/** GET /orders -> the caller's own orders, newest first. */
export function listMyOrders(
  params: { cursor?: string; limit?: number } = {},
): Promise<OrderPage> {
  return getJson<OrderPage>(`/orders${qs(params)}`);
}

/** GET /orders/:id -> the customer, or store operations; 404 to anyone else. */
export function getOrder(id: string): Promise<Order> {
  return getJson<Order>(`/orders/${id}`);
}

/**
 * POST /orders/:id/cancel -> the cancelled order.
 *
 * 409 once it is with the carrier — the customer's answer from there is a
 * refused delivery or a refund. A paid order is refunded as it is cancelled.
 */
export function cancelOrder(id: string): Promise<Order> {
  return postJson<Order>(`/orders/${id}/cancel`, {});
}

/**
 * POST /orders/:id/payment/sync -> where the payment stands, settled if it
 * succeeded. The retry after a 502 from `createOrder`.
 */
export function syncPayment(id: string): Promise<PlacedOrder> {
  return postJson<PlacedOrder>(`/orders/${id}/payment/sync`, {});
}

/* ── Store operations ────────────────────────────────────────────────── */

/** GET /ops/orders -> the fulfilment queue, oldest first. Ops only (403 otherwise). */
export function listFulfilmentQueue(
  params: { cursor?: string; limit?: number } = {},
): Promise<OrderPage> {
  return getJson<OrderPage>(`/ops/orders${qs(params)}`);
}

/**
 * PATCH /orders/:id/status -> the moved order. Ops only.
 *
 * 409 when the move is not legal from where the order is, or when somebody —
 * the fulfilment job, another member of staff — moved it first.
 */
export function updateOrderStatus(
  id: string,
  input: { status: OrderStatus; location?: string; carrier?: string; trackingNumber?: string },
): Promise<Order> {
  return patchJson<Order>(`/orders/${id}/status`, input);
}
