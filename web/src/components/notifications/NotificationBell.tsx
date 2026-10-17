import { Link } from "react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { NotificationKind } from "@/types";
import { getNotifications, markNotificationsRead } from "@/api/notifications";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import {
  AlertIcon,
  BellIcon,
  CheckIcon,
  HeartIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  TruckIcon,
} from "@/components/ui/icons";
import { DURATION, EASE_OUT } from "@/lib/motion";
import { cn, formatDateTime } from "@/lib/utils";

const ICON: Record<NotificationKind, typeof CheckIcon> = {
  booking_accepted: CheckIcon,
  booking_declined: AlertIcon,
  appointment_confirmed: StethoscopeIcon,
  appointment_declined: AlertIcon,
  appointment_completed: StethoscopeIcon,
  order_shipped: TruckIcon,
  order_out_for_delivery: TruckIcon,
  order_delivered: TruckIcon,
  order_payment_failed: AlertIcon,
  membership_started: ShieldCheckIcon,
  membership_payment_failed: AlertIcon,
  membership_cancelled: ShieldCheckIcon,
  membership_ended: ShieldCheckIcon,
  adoption_application_received: HeartIcon,
  adoption_under_review: HeartIcon,
  adoption_approved: CheckIcon,
  adoption_rejected: AlertIcon,
  adoption_completed: HeartIcon,
  adoption_reversed: AlertIcon,
  profile_verified: ShieldCheckIcon,
};

/**
 * Header bell: unread count, and a panel of what happened while you were away.
 *
 * Only rendered for signed-in users — there is nothing to notify an anonymous
 * visitor about, and fetching would just 401 on every page.
 */
export function NotificationBell({ className }: { className?: string }) {
  const { currentUser } = useSession();
  const [open, setOpen] = useState(false);

  const { data, reload } = useAsync(
    () => (currentUser ? getNotifications() : Promise.resolve(null)),
    [currentUser?.id]
  );

  if (!currentUser) return null;

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  async function openPanel() {
    setOpen((wasOpen) => !wasOpen);
    // Opening the panel is the act of reading them — the ones it shows, and
    // only those (REQUIREMENTS.md N7). Anything that arrived since this list
    // was fetched, or that sits beyond it, stays unread.
    const shown = items.filter((n) => n.readAt === null).map((n) => n.id);
    if (!open && shown.length > 0) {
      await markNotificationsRead(shown);
      reload();
    }
  }

  return (
    <div className={cn("relative", className)}>
      <button
        onClick={openPanel}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-mist/40"
      >
        <BellIcon width={19} height={19} />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-leash px-1 font-mono text-[10px] font-medium text-white"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Click-away layer, so the panel closes like a menu should. */}
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className="absolute right-0 z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-2xl border border-mist bg-white shadow-xl shadow-ink/10"
            >
              <p className="border-b border-mist px-4 py-2.5 text-sm font-semibold text-ink">
                Notifications
              </p>

              {items.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-charcoal/60">
                  Nothing yet. Confirmations and delivery updates land here.
                </p>
              ) : (
                <ul className="max-h-96 divide-y divide-mist overflow-y-auto">
                  {items.map((n) => {
                    const Icon = ICON[n.kind];
                    return (
                      <li key={n.id}>
                        <Link
                          to={n.href}
                          onClick={() => setOpen(false)}
                          className="flex gap-3 px-4 py-3 transition-colors hover:bg-fog"
                        >
                          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink/8 text-ink">
                            <Icon width={14} height={14} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink">
                              {n.title}
                            </span>
                            {n.body && (
                              <span className="mt-0.5 block text-xs leading-relaxed text-charcoal/70">
                                {n.body}
                              </span>
                            )}
                            <span className="mt-1 block font-mono text-[10px] text-charcoal/45">
                              {formatDateTime(n.createdAt)}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
