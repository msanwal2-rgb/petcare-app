"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import type { Message } from "@/types";
import { getMessages, sendMessage } from "@/lib/api/messages";
import { useAsync } from "@/lib/hooks/useAsync";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/mock-data/photos";
import { cn, formatDateTime } from "@/lib/utils";

type Person = { name: string; avatarUrl: string };

/**
 * Booking-scoped chat between the owner and caretaker. Polls lightly so a new
 * message from the other party shows up without a manual refresh.
 */
export function MessageThread({
  bookingId,
  currentUserId,
  people,
}: {
  bookingId: string;
  currentUserId: string;
  people: Record<string, Person>;
}) {
  const { data: messages, loading, reload } = useAsync(
    () => getMessages(bookingId),
    [bookingId]
  );
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Light polling for near-real-time updates while the thread is open.
  useEffect(() => {
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await sendMessage(bookingId, text);
      setBody("");
      reload();
    } catch {
      toast.error("Couldn’t send your message. Try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold text-ink">Messages</h2>
      <div className="mt-3 rounded-2xl border border-mist bg-white p-4">
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {loading && messages === null ? (
            <>
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
            </>
          ) : messages && messages.length > 0 ? (
            messages.map((m) => (
              <Bubble
                key={m.id}
                message={m}
                mine={m.fromUserId === currentUserId}
                person={people[m.fromUserId]}
              />
            ))
          ) : (
            <p className="py-6 text-center text-sm text-charcoal/55">
              No messages yet. Say hello 👋
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="mt-3 flex items-center gap-2 border-t border-mist pt-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a message…"
            maxLength={2000}
            className="min-w-0 flex-1 rounded-xl border border-mist bg-fog/40 px-3 py-2 text-sm outline-none focus:border-ink/30"
          />
          <Button type="submit" variant="cta" size="sm" disabled={sending || !body.trim()}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Bubble({
  message,
  mine,
  person,
}: {
  message: Message;
  mine: boolean;
  person?: Person;
}) {
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {person && (
        <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full">
          <Image
            src={person.avatarUrl}
            alt=""
            fill
            sizes="28px"
            placeholder="blur"
            blurDataURL={BLUR_DATA_URL}
            className="object-cover"
          />
        </div>
      )}
      <div className={cn("max-w-[75%]", mine && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-3 py-2 text-sm",
            mine ? "bg-ink text-white" : "bg-fog text-charcoal"
          )}
        >
          {message.body}
        </div>
        <p className="mt-0.5 text-[10px] text-charcoal/45">
          {formatDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}
