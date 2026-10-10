import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { StarIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Post-completion review form.
 *
 * Presentational: it collects a rating and a comment and hands them to
 * `onSubmit`. Bookings and vet appointments post to different endpoints with
 * different rules about who may review whom, and neither of those belongs in
 * a star picker.
 */
export function LeaveReview({
  toName,
  onSubmit,
  prompt = "How did it go? Share the details that would help others.",
}: {
  /** Who is being reviewed, for the heading and the thank-you. */
  toName: string;
  onSubmit: (review: { rating: number; comment: string }) => Promise<unknown>;
  prompt?: string;
}) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      toast.error("Pick a star rating first.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ rating, comment: comment.trim() });
      toast.success(`Thanks for reviewing ${toName.split(" ")[0]}!`);
      setRating(0);
      setComment("");
    } catch (e) {
      // The server owns the rules — surface what it actually said.
      toast.error("Couldn’t save your review", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-[12px] border border-dashed border-mist bg-white p-5"
    >
      <p className="text-sm font-semibold text-ink">Leave a review for {toName}</p>
      <div className="mt-3 flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className="p-0.5"
          >
            <StarIcon
              width={26}
              height={26}
              className={cn(
                "transition-colors",
                (hover || rating) >= n ? "text-marigold" : "text-mist"
              )}
              style={{ fill: (hover || rating) >= n ? "#F2A93B" : "none" }}
            />
          </button>
        ))}
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={prompt}
        className="mt-3"
      />
      <div className="mt-3 flex justify-end">
        <Button type="submit" variant="cta" size="sm" disabled={saving}>
          {saving ? "Posting…" : "Post review"}
        </Button>
      </div>
    </form>
  );
}
