"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { layoutGlide } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface Segment<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented control with a thumb that slides between options rather than
 * snapping — the same shared-element move as the nav indicator, so the two
 * read as one interface language.
 *
 * The role switcher and the pet Details/Health tabs were separate copies of
 * this markup; both now come from here.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  size = "md",
  label,
  className,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  /** Accessible name for the group. */
  label?: string;
  className?: string;
}) {
  // Each instance needs its own layout group, or two controls on one page
  // would animate a single thumb between them.
  const groupId = useId();

  if (segments.length < 2) return null;

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex rounded-full border border-mist bg-white p-0.5",
        className
      )}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            role="tab"
            type="button"
            aria-selected={selected}
            onClick={() => onChange(segment.value)}
            className={cn(
              "relative rounded-full font-medium transition-colors duration-200",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              selected ? "text-white" : "text-charcoal/60 hover:text-ink"
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                transition={layoutGlide}
                className="absolute inset-0 -z-10 rounded-full bg-ink"
              />
            )}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
