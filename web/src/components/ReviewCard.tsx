import type { PublicUser, Review } from "@/types";
import { Avatar } from "./Avatar";
import { RatingStars } from "./RatingStars";
import { formatDate } from "@/lib/utils";

export function ReviewCard({
  review,
  author,
}: {
  review: Review;
  /** The public projection is all a byline needs: a name and a face. */
  author?: PublicUser;
}) {
  return (
    <article className="rounded-[12px] border border-mist bg-white p-5">
      <div className="flex items-center gap-3">
        {author ? (
          <Avatar src={author.avatarUrl} alt={author.name} size={40} />
        ) : (
          <div className="h-10 w-10 rounded-full bg-mist" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {author?.name ?? "Verified customer"}
          </p>
          <p className="font-mono text-[11px] text-charcoal/55">
            {formatDate(review.createdAt)}
          </p>
        </div>
        <RatingStars rating={review.rating} size="sm" />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-charcoal/85">
        “{review.comment}”
      </p>
    </article>
  );
}
