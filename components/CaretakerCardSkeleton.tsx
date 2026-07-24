import { Skeleton } from "./ui/Skeleton";

/** Shimmer placeholder matching CaretakerCard's exact layout (brief §6). */
export function CaretakerCardSkeleton() {
  return (
    <div className="rounded-[12px] border border-mist bg-white shadow-sm">
      <Skeleton className="aspect-[4/3] rounded-t-[12px] rounded-b-none" />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="w-full">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-14 shrink-0" />
        </div>
        <div className="mt-3 flex gap-1.5">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="mt-3.5 border-t border-mist pt-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-1.5 w-full" />
        </div>
      </div>
    </div>
  );
}
