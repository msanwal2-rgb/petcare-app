/**
 * Client wrapper for the assistant's non-streaming endpoints.
 *
 * The chat stream itself does not go through here — useChat owns that
 * connection, and wrapping a stream in a fetch helper would only get in its
 * way. What is left is hydrating a thread after a reload and clearing it.
 */

import { deleteJson, getJsonOrNull } from "./_client";

export interface StoredAssistantMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown;
  text: string;
  createdAt: string;
}

export interface StoredAssistantConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: StoredAssistantMessage[];
}

/** Null when the conversation is gone, or was never this caller's. */
export function getConversation(
  id: string,
): Promise<StoredAssistantConversation | null> {
  return getJsonOrNull<StoredAssistantConversation>(`/api/assistant/conversations/${id}`);
}

export function clearConversation(id: string): Promise<void> {
  return deleteJson(`/api/assistant/conversations/${id}`);
}
