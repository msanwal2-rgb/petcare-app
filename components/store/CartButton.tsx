"use client";

import Link from "next/link";
import { cartCount, useCart } from "@/lib/store/cart";
import { BagIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Cart link with a live item count. The badge waits for the persisted store to
 * rehydrate rather than flashing an empty cart on every page load.
 */
export function CartButton({ className }: { className?: string }) {
  const { lines, hasHydrated } = useCart();
  const count = cartCount(lines);

  return (
    <Link
      href="/store/cart"
      aria-label={count > 0 ? `Cart, ${count} items` : "Cart"}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-mist/40",
        className
      )}
    >
      <BagIcon width={19} height={19} />
      {hasHydrated && count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-leash px-1 font-mono text-[10px] font-medium text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
