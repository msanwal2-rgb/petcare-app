import { motion, useInView } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { DURATION, EASE_OUT, stagger as staggerVariants } from "@/lib/motion";

/**
 * Scroll-triggered reveal: fade plus a short slide-up as the element enters the
 * viewport.
 *
 * Reduced motion is handled globally — `MotionConfig reducedMotion="user"` in
 * `PageTransition` plus the media query in `index.css` — so this never needs to
 * check. Framer swaps to an instant appear.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 16,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: DURATION.slow, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger container: children arrive about 60ms apart. Wrap each in
 * <RevealItem>.
 *
 * Deliberately `animate` driven by `useInView` rather than `whileInView`. With
 * `whileInView` + `once`, the orchestration fires and then stops — a child that
 * mounts afterwards, such as a strip of cards still waiting on a fetch,
 * inherits `hidden` and is never told to show, so it stays invisible forever.
 * A persistent `animate` state is inherited by children whenever they mount,
 * which is exactly what `FeaturedCaretakers` needs.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.06,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -60px 0px" });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      variants={staggerVariants(stagger)}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: DURATION.slow, ease: EASE_OUT },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
