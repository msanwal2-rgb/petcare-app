"use client";

import { motion, MotionConfig } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DURATION, EASE_OUT } from "@/lib/motion";

/**
 * Root-level route transition: a fade with a small rise and a barely-there
 * scale, so a new page settles in rather than cutting. Keyed on pathname so it
 * re-runs per route.
 *
 * No exit animation on purpose. Waiting for the old page to leave before the
 * new one arrives adds latency to every click, and the delay is far more
 * noticeable than the cross-fade is pretty.
 *
 * MotionConfig reducedMotion="user" makes every Framer animation inside the
 * app (reveals, card motion, the leash line, the nav indicator) collapse to an
 * instant state change when the user prefers reduced motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <MotionConfig reducedMotion="user">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12, scale: 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="flex flex-1 flex-col"
      >
        {children}
      </motion.div>
    </MotionConfig>
  );
}
