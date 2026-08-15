/**
 * Notifications — API client. See /lib/api/users.ts for the pattern.
 */

import type { Notification } from "@/types";
import { getJson, postJson } from "./_client";

export interface NotificationFeed {
  items: Notification[];
  unread: number;
}

/** GET /api/notifications -> your own, newest first, with an unread count */
export async function getNotifications(): Promise<NotificationFeed> {
  return getJson<NotificationFeed>("/api/notifications");
}

/** POST /api/notifications -> { unread }. Omit `id` to clear everything. */
export async function markNotificationsRead(
  id?: string
): Promise<{ unread: number }> {
  return postJson<{ unread: number }>("/api/notifications", { id });
}
