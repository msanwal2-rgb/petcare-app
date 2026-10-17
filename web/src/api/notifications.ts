/**
 * Notifications — API client. See ./users.ts for the pattern.
 */

import type { Notification } from "@/types";
import { getJson, postJson } from "./_client";

export interface NotificationFeed {
  items: Notification[];
  /** Across all of your notifications, not just this page. */
  unread: number;
  nextCursor: string | null;
}

/** GET /notifications -> your own, newest first, with an unread count */
export function getNotifications(): Promise<NotificationFeed> {
  return getJson<NotificationFeed>("/notifications");
}

/**
 * POST /notifications { ids } -> { unread }.
 *
 * Marks exactly the ids given — pass the ones that were shown. The reference
 * took no id to mean "clear everything", which also cleared notifications that
 * arrived after the panel was fetched (REQUIREMENTS.md N7).
 */
export function markNotificationsRead(ids: string[]): Promise<{ unread: number }> {
  return postJson<{ unread: number }>("/notifications", { ids });
}
