import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CartLineInput, Product } from "@/types";

/**
 * The shopping cart, persisted to localStorage so a half-filled basket survives
 * a refresh — the one piece of client state a store genuinely owes you.
 *
 * ── What it stores, and why it is safe ──
 *
 * Product ids and quantities, plus a display snapshot so the cart can render
 * without a round trip. **The prices here are for display only**
 * (REQUIREMENTS.md S3). `POST /orders/quote` re-reads every product and
 * recomputes the total, `POST /orders` does it again, and neither request has a
 * price field to send. A tampered localStorage buys nothing.
 *
 * The session store is deliberately *not* persisted; this one is. The
 * difference is what a stale value can do: a stale session could pretend to be
 * somebody, a stale cart can only show yesterday's price beside a total the
 * server corrects.
 */

export interface CartLine {
  productId: string;
  quantity: number;
  /** Display snapshot — never trusted for money. */
  slug: string;
  name: string;
  brand: string;
  imageUrl: string;
  unitPriceCents: number;
  requiresPrescription: boolean;
}

interface CartState {
  lines: CartLine[];
  /** The pet this basket is for. Enables Rx-only items and allergen warnings at checkout. */
  petId: string | null;
  hasHydrated: boolean;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  setPet: (petId: string | null) => void;
  clear: () => void;
}

/** Mirrors the client's sense of a sensible basket; the server's bound is looser. */
export const MAX_PER_LINE = 20;

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      petId: null,
      hasHydrated: false,

      add: (product, quantity = 1) =>
        set((state) => {
          const existing = state.lines.find((l) => l.productId === product.id);
          if (existing) {
            return {
              lines: state.lines.map((l) =>
                l.productId === product.id
                  ? { ...l, quantity: Math.min(l.quantity + quantity, MAX_PER_LINE) }
                  : l,
              ),
            };
          }
          return {
            lines: [
              ...state.lines,
              {
                productId: product.id,
                quantity: Math.min(quantity, MAX_PER_LINE),
                slug: product.slug,
                name: product.name,
                brand: product.brand,
                imageUrl: product.imageUrl,
                unitPriceCents: product.priceCents,
                requiresPrescription: product.requiresPrescription,
              },
            ],
          };
        }),

      setQuantity: (productId, quantity) =>
        set((state) => ({
          lines:
            quantity <= 0
              ? state.lines.filter((l) => l.productId !== productId)
              : state.lines.map((l) =>
                  l.productId === productId
                    ? { ...l, quantity: Math.min(quantity, MAX_PER_LINE) }
                    : l,
                ),
        })),

      remove: (productId) =>
        set((state) => ({ lines: state.lines.filter((l) => l.productId !== productId) })),

      setPet: (petId) => set({ petId }),

      clear: () => set({ lines: [], petId: null }),
    }),
    {
      name: "leash-cart",
      partialize: (state) => ({ lines: state.lines, petId: state.petId }),
      onRehydrateStorage: () => (state) => {
        // Lets the header render a stable badge instead of flashing "0".
        if (state) state.hasHydrated = true;
      },
    },
  ),
);

/** What the cart sends to the server: ids and quantities, nothing else. */
export function cartToLines(lines: CartLine[]): CartLineInput[] {
  return lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

/** Display-only. The server's quote is the authority. */
export function displaySubtotalCents(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}
