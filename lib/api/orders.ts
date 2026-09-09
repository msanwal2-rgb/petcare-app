/**
 * Orders — API client. See /lib/api/bookings.ts for the pattern.
 */

import type {
  CartLineInput,
  CartQuote,
  CreateOrderInput,
  Order,
  OrderStatus,
  PlacedOrder,
} from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson } from "./_client";

/** GET /api/orders -> Order[] (yours, newest first) */
export async function getMyOrders(): Promise<Order[]> {
  return getJson<Order[]>(`/api/orders`);
}

/** GET /api/orders/:id -> Order | null(404) */
export async function getOrderById(id: string): Promise<Order | null> {
  return getJsonOrNull<Order>(`/api/orders/${id}`);
}

/**
 * POST /api/orders/quote -> CartQuote
 * Server-side re-pricing. The cart's own arithmetic is display-only.
 */
export async function quoteCart(
  items: CartLineInput[],
  petId?: string
): Promise<CartQuote> {
  return postJson<CartQuote>(`/api/orders/quote`, { items, petId });
}

/** POST /api/orders -> Order (201) */
export async function placeOrder(input: CreateOrderInput): Promise<PlacedOrder> {
  return postJson<PlacedOrder>(`/api/orders`, input);
}

/** POST /api/orders/:id/cancel -> Order */
export async function cancelOrder(id: string): Promise<Order> {
  return postJson<Order>(`/api/orders/${id}/cancel`, {});
}

/* ── Store operations ─────────────────────────────────────────────────── */

/** GET /api/ops/orders -> Order[] (fulfilment queue, oldest first) */
export async function getFulfillmentQueue(): Promise<Order[]> {
  return getJson<Order[]>(`/api/ops/orders`);
}

/** PATCH /api/orders/:id/status -> Order (ops only) */
export async function advanceOrder(
  id: string,
  status: OrderStatus,
  options: { location?: string; carrier?: string; trackingNumber?: string } = {}
): Promise<Order> {
  return patchJson<Order>(`/api/orders/${id}/status`, { status, ...options });
}

/**
 * POST /api/orders/:id/payment/sync -> Order
 *
 * Ask the server to re-check with the payment provider. The confirmation page
 * calls this because the browser knowing the payment succeeded is not the same
 * as the server knowing it — that arrives on a webhook, which can be slow.
 */
export async function syncOrderPayment(id: string): Promise<Order> {
  return postJson<Order>(`/api/orders/${id}/payment/sync`, {});
}
