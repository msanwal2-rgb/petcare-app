"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The signature motif (brief §3): a gently curved, dashed "leash line" that
 * connects the steps of a journey and *draws itself in* as the user
 * progresses, with a small spring bounce on each completed node.
 *
 * Used for every multi-step journey in the app — requesting a booking, a vet
 * appointment's lifecycle, an order's route to the door — so those three read
 * as the same product rather than three bolted-together modules.
 *
 * Implemented as two identical dashed paths (mist track + leash overlay); the
 * leash overlay is revealed left-to-right by an animated clip rect, so the
 * dashes stay crisp while the line appears to draw. Honors reduced motion via
 * the global MotionConfig.
 */
export function ProgressLeash({
  steps,
  activeIndex,
  label = "Step",
  className,
}: {
  steps: string[];
  /** 0-based index of the current step. */
  activeIndex: number;
  /** Noun for the screen-reader read-out, e.g. "Booking step". */
  label?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const W = 600;
  const H = 96;
  const padX = 60;
  const baseY = 40;
  const n = steps.length;

  const xs = steps.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1));

  // A gently drooping leash between nodes (control points dip below the line).
  let d = `M ${xs[0]} ${baseY}`;
  for (let i = 1; i < n; i++) {
    const x0 = xs[i - 1];
    const x1 = xs[i];
    const cx0 = x0 + (x1 - x0) * 0.35;
    const cx1 = x0 + (x1 - x0) * 0.65;
    d += ` C ${cx0} ${baseY + 16} ${cx1} ${baseY + 16} ${x1} ${baseY}`;
  }

  const fraction = n > 1 ? Math.min(1, Math.max(0, activeIndex / (n - 1))) : 0;

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label} ${activeIndex + 1} of ${n}: ${steps[activeIndex]}`}
      >
        <defs>
          <clipPath id={`leash-clip-${uid}`}>
            <motion.rect
              x={0}
              y={0}
              height={H}
              initial={false}
              animate={{ width: padX + fraction * (W - 2 * padX) + 4 }}
              transition={{ type: "spring", stiffness: 120, damping: 20 }}
            />
          </clipPath>
        </defs>

        {/* mist track */}
        <path
          d={d}
          fill="none"
          stroke="#C8D6C6"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="2 10"
        />
        {/* leash overlay, revealed by the animated clip */}
        <path
          d={d}
          fill="none"
          stroke="#E85C41"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="2 10"
          clipPath={`url(#leash-clip-${uid})`}
        />

        {steps.map((label, i) => {
          const done = i < activeIndex;
          const current = i === activeIndex;
          return (
            <g key={label}>
              <motion.circle
                cx={xs[i]}
                cy={baseY}
                r={done || current ? 13 : 10}
                fill={done ? "#E85C41" : current ? "#1B3B36" : "#FFFFFF"}
                stroke={done ? "#E85C41" : current ? "#1B3B36" : "#C8D6C6"}
                strokeWidth={2}
                initial={false}
                animate={done ? { scale: [1, 1.25, 1] } : { scale: 1 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                style={{ transformOrigin: `${xs[i]}px ${baseY}px` }}
              />
              {done && (
                <path
                  d={`M ${xs[i] - 5} ${baseY} l 3.5 3.5 l 6.5 -7`}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {current && <circle cx={xs[i]} cy={baseY} r={4} fill="#fff" />}
              <text
                x={xs[i]}
                y={baseY + 34}
                textAnchor="middle"
                className="fill-charcoal font-mono"
                style={{ fontSize: 13, fontWeight: current ? 600 : 400 }}
                fill={current || done ? "#1B3B36" : "#6b746f"}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Accessible, non-visual step read-out for screen readers */}
      <span className="sr-only" aria-live="polite">
        {label} {activeIndex + 1} of {n}: {steps[activeIndex]}
      </span>
    </div>
  );
}
