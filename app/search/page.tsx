import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchResults } from "@/components/search/SearchResults";
import { CaretakerCardSkeleton } from "@/components/CaretakerCardSkeleton";

export const metadata: Metadata = {
  title: "Find care",
  description: "Search vetted local pet caretakers by service, dates, and price.",
};

function SearchFallback() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <CaretakerCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchResults />
    </Suspense>
  );
}
