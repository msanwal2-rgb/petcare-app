"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Variant = "cta" | "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium " +
  "transition-colors duration-150 select-none disabled:opacity-50 " +
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

const tap = { scale: 0.97 };

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
      className={classes(variant, size, className)}
      {...props}
    />
  );
}

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
      className={classes(variant, size, className)}
      {...props}
    />
  );
}
