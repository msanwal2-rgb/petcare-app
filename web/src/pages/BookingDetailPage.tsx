import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router";
import type { Booking, BookingStatus, Message, Review } from "@/types";
import {
  createBookingReview,
  getBooking,
  getBookingReviews,
  getMessages,
  markMessagesRead,
  sendMessage,
  updateBookingStatus,
} from "@/api/bookings";
import { getCaretaker, type CaretakerWithUser } from "@/api/caretakers";
import { ApiError } from "@/api/_client";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useSession } from "@/store/session";
import {
  SERVICE_LABELS,
  BOOKING_STATUS_TONE,
  STATUS_LABELS,
  formatCurrency,
  formatDateTime,
  formatRange,
} from "@/lib/utils";

/**
 * One booking: its details, the thread, and whatever action is next.
 *
 * ── The buttons mirror the server's rules, and do not replace them ──
 *
 * Which transitions appear depends on the booking's state and on which side of
 * it you are — the same two tables the API enforces (REQUIREMENTS.md §11.1).
 * Showing an owner an Accept button they would be refused is a worse experience
 * than not showing it. But the check that matters happens server-side on every
 * request: this is UX, and the 403 behind it is the security.
 */
export default function BookingDetailPage() {
  const { id = "" } = useParams();
  const { currentUser } = useSession();

  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [caretaker, setCaretaker] = useState<CaretakerWithUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getBooking(id).then(setBooking).catch(() => setBooking(null));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!booking) return;
    getCaretaker(booking.caretakerId).then(setCaretaker).catch(() => setCaretaker(null));
  }, [booking]);

  if (booking === undefined) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-12 sm:px-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (booking === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-xl font-semibold text-ink">Booking not found</h1>
        <p className="mt-2 text-sm text-charcoal/60">
          It may not exist, or it may not be yours.
        </p>
      </div>
    );
  }

  const isOwner = currentUser?.id === booking.ownerId;
  const isCaretaker =
    caretaker !== null && currentUser?.id === caretaker.user.id;

  async function move(status: BookingStatus) {
    setError(null);
    try {
      setBooking(await updateBookingStatus(id, status));
    } catch (err) {
      // A 409 means the booking moved under us; a 403 means the wrong party.
      // Both carry a message worth showing verbatim.
      setError(err instanceof ApiError ? err.message : "Could not update this booking");
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <section className="rounded-2xl border border-mist bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {SERVICE_LABELS[booking.serviceType]}
              {caretaker && (
                <span className="text-charcoal/55"> with {caretaker.user.name}</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-charcoal/60">
              {formatRange(booking.startDateTime, booking.endDateTime)}
            </p>
          </div>
          <StatusBadge
            tone={BOOKING_STATUS_TONE[booking.status]}
            label={STATUS_LABELS[booking.status]}
          />
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <Detail label="Price" value={formatCurrency(booking.priceTotal)} />
          <Detail label="Pets" value={`${booking.petIds.length} on this booking`} />
          <Detail label="Requested" value={formatDateTime(booking.createdAt)} />
          {booking.notes && <Detail label="Notes" value={booking.notes} />}
        </dl>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-leash"
          >
            {error}
          </p>
        )}

        <Actions
          status={booking.status}
          isOwner={isOwner}
          isCaretaker={isCaretaker}
          onMove={move}
        />
      </section>

      <MessagesPanel bookingId={id} currentUserId={currentUser?.id ?? ""} />

      {booking.status === "completed" && caretaker && (
        <ReviewPanel
          bookingId={id}
          currentUserId={currentUser?.id ?? ""}
          otherUserId={isOwner ? caretaker.user.id : booking.ownerId}
        />
      )}
    </div>
  );
}

/**
 * The moves available from here, to this person.
 *
 * A direct transcription of the two tables in REQUIREMENTS.md §11.1:
 * accept/decline/start/complete belong to the caretaker, and either side may
 * cancel while the booking is not yet terminal.
 */
function Actions({
  status,
  isOwner,
  isCaretaker,
  onMove,
}: {
  status: BookingStatus;
  isOwner: boolean;
  isCaretaker: boolean;
  onMove: (status: BookingStatus) => void;
}) {
  const caretakerMoves: Partial<Record<BookingStatus, [BookingStatus, string][]>> = {
    requested: [
      ["accepted", "Accept"],
      ["declined", "Decline"],
    ],
    accepted: [["in_progress", "Start"]],
    in_progress: [["completed", "Mark complete"]],
  };

  const moves = isCaretaker ? (caretakerMoves[status] ?? []) : [];
  const canCancel =
    (isOwner || isCaretaker) &&
    ["requested", "accepted", "in_progress"].includes(status);

  if (moves.length === 0 && !canCancel) return null;

  return (
    <div className="mt-6 flex flex-wrap gap-3 border-t border-mist pt-5">
      {moves.map(([next, label]) => (
        <Button key={next} variant="cta" size="sm" onClick={() => onMove(next)}>
          {label}
        </Button>
      ))}
      {canCancel && (
        <Button variant="ghost" size="sm" onClick={() => onMove("cancelled")}>
          Cancel booking
        </Button>
      )}
    </div>
  );
}

function MessagesPanel({
  bookingId,
  currentUserId,
}: {
  bookingId: string;
  currentUserId: string;
}) {
  const [thread, setThread] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    getMessages(bookingId).then(setThread).catch(() => setThread([]));
  }, [bookingId]);

  useEffect(load, [load]);

  // Marking read is its own request, fired after the thread is on screen —
  // never folded into the GET. See REQUIREMENTS.md C10: doing it inside the
  // read made an unread message impossible to observe.
  useEffect(() => {
    if (!thread?.some((m) => m.fromUserId !== currentUserId && m.readAt === null)) return;
    markMessagesRead(bookingId).then(load).catch(() => {});
  }, [thread, bookingId, currentUserId, load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;

    setSending(true);
    try {
      await sendMessage(bookingId, draft.trim());
      setDraft("");
      load();
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Messages</h2>

      {thread === null ? (
        <Skeleton className="mt-4 h-24 rounded-xl" />
      ) : thread.length === 0 ? (
        <p className="mt-3 text-sm text-charcoal/60">
          Nothing yet. Say hello — they can see this thread too.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {thread.map((message) => {
            const mine = message.fromUserId === currentUserId;
            return (
              <li
                key={message.id}
                className={mine ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm " +
                    (mine ? "bg-ink text-white" : "bg-mist/50 text-ink")
                  }
                >
                  <p>{message.body}</p>
                  <p
                    className={
                      "mt-1 text-[10px] " +
                      (mine ? "text-white/55" : "text-charcoal/50")
                    }
                  >
                    {formatDateTime(message.createdAt)}
                    {mine && message.readAt && " · Read"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={send} className="mt-5 flex gap-3">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message"
          aria-label="Message"
        />
        <Button type="submit" disabled={sending || !draft.trim()}>
          Send
        </Button>
      </form>
    </section>
  );
}

function ReviewPanel({
  bookingId,
  currentUserId,
  otherUserId,
}: {
  bookingId: string;
  currentUserId: string;
  otherUserId: string;
}) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getBookingReviews(bookingId).then(setReviews).catch(() => setReviews([]));
  }, [bookingId]);

  useEffect(load, [load]);

  const alreadyMine = reviews.some((r) => r.fromUserId === currentUserId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createBookingReview(bookingId, { toUserId: otherUserId, rating, comment });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not leave that review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-mist bg-white p-6">
      <h2 className="text-lg font-semibold text-ink">Reviews</h2>
      <p className="mt-1 text-sm text-charcoal/60">
        Both sides review each other, once each.
      </p>

      {reviews.length > 0 && (
        <ul className="mt-5 space-y-4">
          {reviews.map((review) => (
            <li key={review.id} className="border-l-2 border-mist pl-4">
              <p className="text-sm text-charcoal/70">
                {review.rating.toFixed(1)} ★
                {review.fromUserId === currentUserId && (
                  <span className="text-charcoal/45"> · yours</span>
                )}
              </p>
              {review.comment && (
                <p className="mt-1 text-sm text-ink">{review.comment}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {alreadyMine ? (
        <p className="mt-5 text-sm text-charcoal/60">
          You have already reviewed this booking.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4 border-t border-mist pt-5">
          {error && (
            <p role="alert" className="text-sm text-leash">
              {error}
            </p>
          )}

          <Field label="Rating" hint="1–5" htmlFor="rating">
            <Input
              id="rating"
              type="number"
              min={1}
              max={5}
              step={0.5}
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            />
          </Field>

          <Field label="Comment" htmlFor="comment">
            <Textarea
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="How did it go?"
            />
          </Field>

          <Button type="submit" variant="cta" disabled={saving}>
            {saving ? "Posting…" : "Leave review"}
          </Button>
        </form>
      )}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-widest text-charcoal/50">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
    </div>
  );
}
