/**
 * Users domain — API client. Pages/components import ONLY from here. Each
 * function calls its real HTTP endpoint; signatures are unchanged from the
 * original mock so no page or component code needed to change.
 */

import type { PublicUser, User, UserRole } from "@/types";
import { getJson, getJsonOrNull, patchJson, postJson, qs } from "./_client";

/**
 * GET /api/users/:id -> PublicUser | null(404)
 *
 * The public projection — name, avatar, roles, city. For your own account use
 * `getCurrentUser()` (/api/me), which returns everything.
 */
export async function getUserById(id: string): Promise<PublicUser | null> {
  return getJsonOrNull<PublicUser>(`/api/users/${id}`);
}

/** GET /api/users?ids=a,b,c -> PublicUser[] */
export async function getUsersByIds(ids: string[]): Promise<PublicUser[]> {
  if (ids.length === 0) return [];
  return getJson<PublicUser[]>(`/api/users${qs({ ids: ids.join(",") })}`);
}

/** GET /api/users -> User[] (dev/demo account switcher) */
export async function listUsers(): Promise<User[]> {
  return getJson<User[]>(`/api/users`);
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
