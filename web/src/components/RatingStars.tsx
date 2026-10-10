import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * A rating as five partially-filled stars plus the number.
 *
 * The fill is a gradient with a hard stop at the fractional part, so 4.3 shows
 * a star filled 30% of the way rather than rounding to a half. The number is
 * there too, because a row of stars is an impression and the figure is the fact.
 *
 * `useId` gives each instance a stable, unique gradient id. `Math.random()`
 * would work in the browser but collides across instances rendered in the same
 * tick, and the symptom — every star on the page taking the first card's fill —
 * is baffling to debug.
 */
export function RatingStars({
  rating,
  reviewCount,
  size = "md",
  className,
}: {
  rating: number;
  reviewCount?: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const uid = useId();
  const px = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  const text = size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm";

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      aria-label={`${rating.toFixed(1)} out of 5${
        reviewCount != null ? `, ${reviewCount} reviews` : ""
      }`}
    >
      <span className="flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => {
          const fill = Math.max(0, Math.min(1, rating - i));
          const gid = `${uid}-${i}`.replace(/:/g, "");
          return (
            <span key={i} className={px}>
              <svg viewBox="0 0 20 20" className="h-full w-full" aria-hidden>
                <defs>
                  <linearGradient id={gid}>
                    <stop offset={`${fill * 100}%`} stopColor="#F2A93B" />
                    <stop offset={`${fill * 100}%`} stopColor="#C8D6C6" />
                  </linearGradient>
                </defs>
                <path
                  d="M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85z"
                  fill={`url(#${gid})`}
                />
              </svg>
            </span>
          );
        })}
      </span>
      <span className={cn("font-mono font-medium text-charcoal", text)}>
        {rating.toFixed(1)}
      </span>
      {reviewCount != null && (
        <span className={cn("text-charcoal/55", text)}>({reviewCount})</span>
      )}
    </span>
  );
}
