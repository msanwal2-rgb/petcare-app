import { motion } from "framer-motion";
import { Link } from "react-router";
import type { ComponentProps } from "react";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

type Variant = "cta" | "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "transition-[background-color,border-color,color,box-shadow] duration-300 " +
  "ease-[cubic-bezier(0.22,1,0.36,1)] select-none disabled:opacity-50 " +
  "disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2";

const variants: Record<Variant, string> = {
  // leash accent — reserved for the single primary action on a screen (§3)
  cta: "bg-leash text-white hover:bg-leash-hover shadow-sm focus-visible:outline-leash",
  primary: "bg-ink text-white hover:bg-ink-hover shadow-sm focus-visible:outline-ink",
  outline:
    "border border-mist bg-white text-ink hover:border-ink hover:bg-white focus-visible:outline-ink",
  ghost: "text-ink hover:bg-mist/40 focus-visible:outline-ink",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3.5 py-1.5",
  md: "text-sm px-5 py-2.5",
  lg: "text-base px-6 py-3",
};

function classes(variant: Variant, size: Size, className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

/**
 * Press and hover feel. The lift is small and the press is smaller — a button
 * should acknowledge the cursor, not perform. Both settle on the app's easing
 * so they match the cards and the nav.
 */
const tap = { scale: 0.97 };
const hover = { y: -1 };
const feel = { duration: DURATION.fast, ease: EASE_OUT } as const;

type ButtonProps = ComponentProps<typeof motion.button> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileTap={tap}
      whileHover={hover}
      transition={feel}
      className={classes(variant, size, className)}
      {...props}
    />
  );
}

/**
 * The link-shaped button.
 *
 * Ported from `next/link` to React Router's `Link`: `href` becomes `to`, and
 * the 56 call sites across the app change one prop name. Everything else about
 * this component is unchanged.
 */
const MotionLink = motion.create(Link);

type ButtonLinkProps = ComponentProps<typeof MotionLink> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <MotionLink
      whileTap={tap}
      whileHover={hover}
      transition={feel}
      className={classes(variant, size, className)}
      {...props}
    />
  );
}
