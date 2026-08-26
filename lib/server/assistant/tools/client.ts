/**
 * Tools the browser executes, not the server.
 *
 * There is exactly one, and it is here because the cart is client state: a
 * persisted Zustand store in localStorage, with no server-side representation.
 * A server tool could not add to it.
 *
 * That turns out to be the right shape anyway. The cart stays the single
 * source of truth for what the customer is buying, and checkout still re-prices
 * every line server-side through /api/orders/quote — so the assistant nudging
 * something into a cart can never affect what is charged.
 *
 * Defined with no `execute`: the AI SDK forwards the call to the client, and
 * useChat's onToolCall resolves it and reports back with addToolOutput.
 */

import { tool } from "ai";
import { z } from "zod";

export function clientTools() {
  return {
    addToCart: tool({
      description:
        "Add a product to the customer's cart. Confirm the product and quantity with them first. This does not buy anything — they still go to checkout and place the order themselves.",
      inputSchema: z.object({
        slug: z.string().describe("Product slug, from searchProducts or getProduct."),
        quantity: z.number().int().min(1).max(20).default(1),
      }),
      // No execute: resolved in the browser.
    }),
  };
}
