import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import { cartCount, useCart } from "@/store/cart";
import { BagIcon } from "@/components/ui/icons";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The header's cart link, with a live item count. The badge waits for the
 * persisted cart to rehydrate rather than flashing "0" on every page load.
 */
export function CartButton({ className }: { className?: string }) {
  const { lines, hasHydrated } = useCart();
  const count = cartCount(lines);

  return (
    <Link
      to="/store/cart"
      aria-label={count > 0 ? `Cart, ${count} items` : "Cart"}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-mist/40",
        className,
      )}
    >
      <BagIcon
        width={19}
        height={19}
        className="transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-px group-hover:scale-110"
      />
      {/* Keyed on the count so adding an item re-runs the pop. */}
      <AnimatePresence>
        {hasHydrated && count > 0 && (
          <motion.span
            key={count}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ duration: DURATION.fast, ease: EASE_OUT }}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-leash px-1 font-mono text-[10px] font-medium text-white"
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}
