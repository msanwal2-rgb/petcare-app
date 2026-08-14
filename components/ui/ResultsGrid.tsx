"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { RevealItem } from "./Reveal";
import { SearchIcon } from "./icons";
import { cn } from "@/lib/utils";

/**
 * The three states every search result list has — loading, nothing found, and
 * a grid of cards — in one place, so the caretaker, vet and store searches
 * can't drift apart on skeleton count, grid gutters, or empty-state layout.
 */
export function ResultsGrid<T extends { id: string }>({
  items,
  loading,
  renderItem,
  skeleton,
  skeletonCount = 6,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  emptyActionHref,
  className,
}: {
  items: T[] | null;
  loading: boolean;
  renderItem: (item: T) => ReactNode;
  /** One placeholder card; rendered `skeletonCount` times while loading. */
  skeleton: ReactNode;
  skeletonCount?: number;
  emptyTitle: string;
  emptyDescription: string;
  emptyActionLabel?: string;
  emptyActionHref?: string;
  /** Overrides the grid columns; defaults to the 1/2/3 search layout. */
  className?: string;
}) {
  const grid = cn(
    "grid gap-5",
    className ?? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
  );

  if (loading || items === null) {
    return (
      <div className={grid}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i}>{skeleton}</div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon width={40} height={40} />}
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        actionHref={emptyActionHref}
      />
    );
  }

  return (
    <div className={grid}>
      {items.map((item) => (
        <RevealItem key={item.id}>{renderItem(item)}</RevealItem>
      ))}
    </div>
  );
}
