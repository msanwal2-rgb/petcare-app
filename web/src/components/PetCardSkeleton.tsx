import { Skeleton } from "./ui/Skeleton";

/** Shimmer placeholder matching PetCard's layout. */
export function PetCardSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-[12px] border border-mist bg-white p-3">
      <Skeleton className="aspect-square w-20 rounded-lg" />
      <div className="flex-1">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-2 h-3 w-1/2" />
        <div className="mt-2.5 flex gap-1.5">
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="h-4 w-12 rounded-full" />
        </div>
      </div>
    </div>
  );
}
