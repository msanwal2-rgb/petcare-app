"use client";

/**
 * The chat panel.
 *
 * Structure and motion follow components/notifications/NotificationBell — same
 * surface treatment, same easing, same click-away — because a second overlay
 * idiom in one app is a bug. The additions are the ones a panel you *type* into
 * needs: a dialog role, a focus trap, Escape to close, and a live region so a
 * screen reader hears the settled answer rather than every streamed token.
 *
 * The one tool executed here rather than on the server is addToCart. The cart
 * is a persisted Zustand store with no server representation, so the browser is
 * the only place that can act on it — and keeping it here means the price the
 * customer eventually pays still comes from /api/orders/quote, untouched by
 * anything the model said.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { XIcon } from "@/components/ui/icons";
import { DURATION, EASE_GLIDE, EASE_OUT } from "@/lib/motion";
import { useSession } from "@/lib/store/session";
import { useCart } from "@/lib/store/cart";
import { getProductBySlug } from "@/lib/api/products";
import { getConversation, clearConversation } from "@/lib/api/assistant";
import { AssistantMessage } from "./AssistantMessage";
import { useFocusTrap } from "./useFocusTrap";

/**
 * sessionStorage, not localStorage: an anonymous conversation must not survive
 * into the next person's session on a shared machine, and must not follow
 * someone across a sign-in.
 */
const STORAGE_KEY = "leash.assistant.conversation";

/**
 * What the server attaches to each reply. Only the thread id, for now.
 */
type AssistantMeta = { conversationId?: string };
type PanelMessage = UIMessage<AssistantMeta>;

const GREETING =
  "I can help with orders and deliveries, bookings, vet appointments, and how anything here works. What do you need?";

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();
  const { currentUser } = useSession();

  const [input, setInput] = useState("");
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  /**
   * The thread id from a previous page view, read once at mount. A lazy
   * initializer rather than an effect: this is state we *have* on the first
   * render, and setting it from an effect would cost a second render for
   * nothing.
   */
  const [storedId] = useState<string | null>(() =>
    typeof window === "undefined" ? null : sessionStorage.getItem(STORAGE_KEY),
  );
  const [initial, setInitial] = useState<PanelMessage[] | null>(storedId ? null : []);


  useFocusTrap(panelRef, true, onClose);

  // Rejoin the stored thread, if the server still says it is ours. It will not
  // be if the customer has signed in or out since — that scoping is enforced
  // server-side, and the empty result here is the honest consequence.
  useEffect(() => {
    if (!storedId) return;
    let cancelled = false;
    getConversation(storedId)
      .then((conversation) => {
        if (cancelled) return;
        if (!conversation) {
          sessionStorage.removeItem(STORAGE_KEY);
          setInitial([]);
          return;
        }
        setInitial(
          conversation.messages.map((message) => ({
            id: message.id,
            role: message.role,
            parts: message.parts as PanelMessage["parts"],
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setInitial([]);
      });
    return () => {
      cancelled = true;
    };
  }, [storedId]);

  const { messages, sendMessage, status, stop, addToolOutput, error } = useChat<PanelMessage>({
    id: storedId ?? "assistant",
    messages: initial ?? [],
    transport: new DefaultChatTransport({ api: "/api/assistant/chat" }),
    // The cart lives in the browser, so this is the one tool resolved here.
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== "addToCart") return;
      const { slug, quantity } = toolCall.input as { slug: string; quantity: number };
      try {
        // Re-fetch the product rather than trusting anything from the model:
        // the cart's price snapshot has to come from the server.
        const product = await getProductBySlug(slug);
        if (!product) {
          addToolOutput({
            tool: "addToCart",
            toolCallId: toolCall.toolCallId,
            output: { added: false, reason: "No such product." },
          });
          return;
        }
        useCart.getState().add(product, quantity);
        addToolOutput({
          tool: "addToCart",
          toolCallId: toolCall.toolCallId,
          output: { added: true, name: product.name, quantity },
        });
      } catch {
        addToolOutput({
          tool: "addToCart",
          toolCallId: toolCall.toolCallId,
          output: { added: false, reason: "Couldn't reach the store." },
        });
      }
    },
  });

  /**
   * The live thread id, taken off the newest reply's metadata. Derived rather
   * than stored: it is a pure function of the messages we already have.
   */
  const metadataId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const meta = messages[i].metadata as { conversationId?: string } | undefined;
      if (meta?.conversationId) return meta.conversationId;
    }
    return null;
  }, [messages]);

  // Persist the id so a reload rejoins this thread. A write to something
  // outside React, which is what an effect is for — and no setState, so a
  // streaming reply does not cost an extra render per chunk.
  useEffect(() => {
    if (metadataId) sessionStorage.setItem(STORAGE_KEY, metadataId);
  }, [metadataId]);

  const conversationId = metadataId ?? storedId;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, status]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const busy = status === "submitted" || status === "streaming";

  /**
   * The thread id and current page ride along per message rather than being
   * baked into the transport. That keeps them current without making the
   * transport depend on state that is itself derived from the transport's
   * output.
   */
  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage(
      { text },
      { body: { conversationId: conversationId ?? undefined, path: pathname } },
    );
    setInput("");
  }, [input, busy, sendMessage, conversationId, pathname]);

  const onClear = useCallback(async () => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        await clearConversation(stored);
      } catch {
        // A thread that is already gone is not worth interrupting anyone over.
      }
    }
    sessionStorage.removeItem(STORAGE_KEY);
    toast.success("Chat cleared.");
    onClose();
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="assistant-title"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: DURATION.base, ease: EASE_GLIDE }}
      className="fixed inset-x-3 bottom-3 top-16 z-50 flex flex-col overflow-hidden rounded-2xl border border-mist bg-white shadow-xl shadow-ink/10 sm:inset-x-auto sm:right-6 sm:top-auto sm:bottom-24 sm:h-[560px] sm:max-h-[calc(100vh-8rem)] sm:w-[380px]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-mist px-4 py-2.5">
        <p id="assistant-title" className="text-sm font-semibold text-ink">
          Scout
          <span className="ml-2 font-mono text-[10px] font-normal uppercase tracking-wide text-charcoal/45">
            Support
          </span>
        </p>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg px-2 py-1 text-xs text-charcoal/60 transition-colors hover:bg-fog hover:text-ink"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close support chat"
            className="rounded-lg p-1.5 text-charcoal/60 transition-colors hover:bg-fog hover:text-ink"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!currentUser && !nudgeDismissed && (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-mist bg-fog/60 px-3 py-2">
            <p className="text-xs text-charcoal/75">
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
                className="font-medium text-ink underline underline-offset-2"
              >
                Sign in
              </Link>{" "}
              to ask about your orders, bookings and pets.
            </p>
            <button
              type="button"
              onClick={() => setNudgeDismissed(true)}
              aria-label="Dismiss"
              className="shrink-0 text-charcoal/40 hover:text-ink"
            >
              <XIcon width={13} height={13} />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {messages.length === 0 && (
            <p className="self-start max-w-[85%] rounded-2xl bg-fog px-3 py-2 text-sm text-charcoal">
              {GREETING}
            </p>
          )}

          {messages.map((message) => (
            <AssistantMessage key={message.id} message={message} />
          ))}

          {/* Announce the settled answer once, not once per token. */}
          <div aria-live="polite" aria-atomic="false" className="sr-only">
            {status === "ready" && messages.length > 0
              ? messages[messages.length - 1]?.parts
                  .filter((part): part is { type: "text"; text: string } => part.type === "text")
                  .map((part) => part.text)
                  .join(" ")
              : ""}
          </div>

          {status === "submitted" && (
            <div className="self-start rounded-2xl bg-fog px-3 py-2">
              <span className="shimmer block h-3 w-24 rounded-md" />
            </div>
          )}

          {error && (
            <div className="self-start rounded-xl border border-leash/30 bg-leash/[0.05] px-3 py-2 text-sm text-charcoal">
              <p>Something went wrong reaching support.</p>
              <button
                type="button"
                onClick={() =>
                  sendMessage(
                    { text: input || "Try that again" },
                    { body: { conversationId: conversationId ?? undefined, path: pathname } },
                  )
                }
                className="mt-1 font-medium text-ink underline underline-offset-2"
              >
                Try again
              </button>
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <form
        className="border-t border-mist p-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Ask about an order, a booking, a pet…"
            aria-label="Message"
            className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-xl border border-mist bg-fog/40 px-3 py-2 text-sm text-charcoal placeholder:text-charcoal/40 focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/15"
          />
          {busy ? (
            <Button type="button" variant="outline" size="sm" onClick={() => stop()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="cta" size="sm" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-charcoal/45">
          Scout can look things up and cancel orders. It never buys or books
          anything for you.
        </p>
      </form>
    </motion.div>
  );
}

/** Exported for the launcher, which has to know whether motion is safe to run. */
export { EASE_OUT };
