"use client";

/**
 * The floating launcher, and the host for the panel.
 *
 * Mounted from app/layout.tsx as a sibling of <main>, which is load-bearing in
 * two ways. It survives PageTransition's pathname-keyed remount, so a
 * conversation is not thrown away by navigating. And it sits outside the
 * subtree that e2e:sweep scans for content stuck at opacity 0 — a panel
 * animating in is transiently invisible by design, and inside <main> that would
 * read as the bug the sweep exists to catch.
 *
 * The panel is keyed by identity so signing in or out starts a fresh thread
 * rather than carrying one across the boundary. The server refuses to hand a
 * thread to the wrong caller regardless; this just means the UI agrees.
 */

import { useCallback, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ChatIcon } from "@/components/ui/icons";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { useSession } from "@/lib/store/session";
import { AssistantPanel } from "./AssistantPanel";

export function AssistantLauncher({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const { currentUser } = useSession();
  const close = useCallback(() => setOpen(false), []);

  if (!enabled) return null;

  return (
    // PageTransition's MotionConfig is inside <main>, and this is not, so the
    // reduced-motion preference has to be honoured here too. Without it the
    // panel would still slide for someone who asked it not to.
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <>
            {/* Click-away, exactly as NotificationBell does it. */}
            <button
              aria-hidden
              tabIndex={-1}
              onClick={close}
              className="fixed inset-0 z-40 cursor-default"
            />
            <AssistantPanel key={currentUser?.id ?? "anonymous"} onClose={close} />
          </>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-label={open ? "Close support chat" : "Open support chat"}
        aria-expanded={open}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-lg shadow-ink/20 transition-colors hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leash focus-visible:ring-offset-2 print:hidden"
      >
        <ChatIcon width={22} height={22} />
      </motion.button>
    </MotionConfig>
  );
}
