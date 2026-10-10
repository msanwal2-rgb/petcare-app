import { useEffect, useState } from "react";
import { searchCaretakers, type CaretakerWithUser } from "@/api/caretakers";
import { CaretakerCard, CaretakerCardSkeleton } from "./CaretakerCard";
import { RevealItem } from "./ui/Reveal";

/** Four cards fill the row at every breakpoint the grid uses. */
const COUNT = 4;

/**
 * The top-rated caretakers strip on the landing page.
 *
 * `limit: 4` rather than fetching everything and slicing, which is what the
 * reference did. The search is cursor-paginated and sorts best-rated first when
 * no location is given, so asking for four and taking four is the whole query —
 * the landing page of a marketplace with ten thousand caretakers should not
 * download ten thousand caretakers.
 *
 * A failure renders nothing rather than an error. This is a promotional strip
 * below the fold: if it cannot load, the page above it still works and the
 * "See all" link beside the heading still goes to search. An error panel here
 * would be louder than the problem.
 */
export function FeaturedCaretakers() {
  const [items, setItems] = useState<CaretakerWithUser[] | null>(null);

  useEffect(() => {
    let live = true;

    searchCaretakers({ limit: COUNT })
      .then((page) => {
        if (live) setItems(page.items);
      })
      .catch(() => {
        if (live) setItems([]);
      });

    // The landing page is the most likely place for somebody to navigate away
    // mid-flight, and setting state after unmount is a warning nobody needs.
    return () => {
      live = false;
    };
  }, []);

  if (items?.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {items === null
        ? Array.from({ length: COUNT }).map((_, i) => <CaretakerCardSkeleton key={i} />)
        : items.map((caretaker) => (
            <RevealItem key={caretaker.profile.id}>
              <CaretakerCard caretaker={caretaker} />
            </RevealItem>
          ))}
    </div>
  );
}
