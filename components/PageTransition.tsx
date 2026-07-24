"use client";

import { motion, MotionConfig } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Root-level route transition (brief §3, §6): a quick fade + 8px slide on each
 * navigation — never a hard cut. Keyed on pathname so it re-runs per route.
 *
 * MotionConfig reducedMotion="user" makes every Framer animation inside the
 * app (reveals, card motion, the leash line) collapse to an instant state
 * change when the user prefers reduced motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-1 flex-col"
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
