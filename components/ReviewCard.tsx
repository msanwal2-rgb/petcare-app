import Image from "next/image";
import type { Review, User } from "@/types";
import { RatingStars } from "./RatingStars";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import { formatDate } from "@/lib/utils";

export function ReviewCard({
  review,
  author,
}: {
  review: Review;
  author?: User;
}) {
  return (
    <article className="rounded-[12px] border border-mist bg-white p-5">
      <div className="flex items-center gap-3">
        {author ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-full">
            <Image
              src={author.avatarUrl}
              alt={author.name}
              fill
              sizes="40px"
              placeholder="blur"
              blurDataURL={BLUR_DATA_URL}
              className="object-cover"
            />
          </div>
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
