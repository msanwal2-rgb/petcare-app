"use client";

import { searchCaretakers } from "@/lib/api/caretakers";
import { useAsync } from "@/lib/hooks/useAsync";
import { CaretakerCard } from "./CaretakerCard";
import { CaretakerCardSkeleton } from "./CaretakerCardSkeleton";
import { RevealItem } from "./ui/Reveal";

/** Top-rated caretakers strip for the landing page. Client-side so the
 *  simulated API delay is covered by real skeleton loaders (brief §3). */
export function FeaturedCaretakers() {
  const { data, loading } = useAsync(() => searchCaretakers(), []);
  const featured = (data ?? []).slice(0, 4);

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {loading || data === null
        ? Array.from({ length: 4 }).map((_, i) => (
            <CaretakerCardSkeleton key={i} />
          ))
        : featured.map((c) => (
            <RevealItem key={c.id}>
              <CaretakerCard caretaker={c} />
            </RevealItem>
          ))}
    </div>
  );
}
