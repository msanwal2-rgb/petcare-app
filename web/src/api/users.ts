import type { PublicUser, User, UserRole } from "@/types";
import { getJson, getJsonOrNull, patchJson, qs } from "./_client";

/**
 * Users domain — API client. Pages and components import ONLY from here.
 *
 * One file per domain, and nothing outside `src/api` calls `fetch`. That rule
 * is what kept the reference project's frontend portable enough to move here
 * with two lines changed, and it is worth keeping for the same reason.
 */

/**
 * GET /users/:id -> PublicUser | null(404)
 *
 * The public projection — name, avatar, roles, city. For your own account use
 * `getCurrentUser()` (/me), which returns everything.
 */
export function getUserById(id: string): Promise<PublicUser | null> {
  return getJsonOrNull<PublicUser>(`/users/${id}`);
}

/** GET /users?ids=a,b,c -> PublicUser[] */
export function getUsersByIds(ids: string[]): Promise<PublicUser[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return getJson<PublicUser[]>(`/users${qs({ ids: ids.join(",") })}`);
}

/** GET /users -> User[] — the development account switcher only. */
export function listUsers(): Promise<User[]> {
  return getJson<User[]>("/users");
}

/** GET /me -> the authenticated user's full record. */
export function getCurrentUser(): Promise<User> {
  return getJson<User>("/me");
}

/** PATCH /users/:id -> User */
export function updateUser(
  id: string,
  patch: {
    name?: string;
    phone?: string;
    avatarUrl?: string;
    roles?: UserRole[];
    address?: { city: string; state: string; lat: number; lng: number };
  },
): Promise<User> {
  return patchJson<User>(`/users/${id}`, patch);
}
