import { cn } from "@/lib/utils";

/**
 * Base skeleton block with the shimmer sweep (brief §3). Never a bare spinner —
 * compose these into content-shaped placeholders (see CaretakerCardSkeleton).
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-md", className)} />;
}
