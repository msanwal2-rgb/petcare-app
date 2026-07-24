/**
 * Users domain — API client. Pages/components import ONLY from here. Each
 * function calls its real HTTP endpoint; signatures are unchanged from the
 * original mock so no page or component code needed to change.
 */

import type { User, UserRole } from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson, qs } from "./_client";

/** GET /api/users/:id -> User | null(404) */
export async function getUserById(id: string): Promise<User | null> {
  return getJsonOrNull<User>(`/api/users/${id}`);
}

/** GET /api/users?ids=a,b,c -> User[] */
export async function getUsersByIds(ids: string[]): Promise<User[]> {
  if (ids.length === 0) return [];
  return getJson<User[]>(`/api/users${qs({ ids: ids.join(",") })}`);
}

/** GET /api/users -> User[] (dev/demo account switcher) */
export async function listUsers(): Promise<User[]> {
  return getJson<User[]>(`/api/users`);
}

/** POST /api/users -> User (201) */
export async function createUser(input: {
  name: string;
  email: string;
  phone?: string;
  roles?: UserRole[];
}): Promise<User> {
  return postJson<User>(`/api/users`, input);
}

/** POST /api/signup -> User (201) — creates an email/password account. */
export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  roles?: UserRole[];
}): Promise<User> {
  return postJson<User>(`/api/signup`, input);
}

/** PATCH /api/users/:id -> User */
export async function updateUser(
  id: string,
  patch: Partial<User>
): Promise<User> {
  return patchJson<User>(`/api/users/${id}`, patch);
}
