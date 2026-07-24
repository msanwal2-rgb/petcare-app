/**
 * Messages domain — API client. See /lib/api/users.ts for the pattern.
 */

import type { Message } from "@/types";
import { getJson, postJson } from "./_client";

/** GET /api/bookings/:bookingId/messages -> Message[] (oldest first) */
export async function getMessages(bookingId: string): Promise<Message[]> {
  return getJson<Message[]>(`/api/bookings/${bookingId}/messages`);
}

/** POST /api/bookings/:bookingId/messages -> Message (201) */
export async function sendMessage(
  bookingId: string,
  body: string
): Promise<Message> {
  return postJson<Message>(`/api/bookings/${bookingId}/messages`, { body });
}
