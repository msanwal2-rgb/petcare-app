/**
 * Users domain — API client. Pages/components import ONLY from here, never
 * from /lib/mock-data. Swapping the mock body for a real `fetch` is a
 * one-file change. Each function documents the real endpoint it stands in for.
 */

import type { User, UserRole } from "@/types";
import { db, delay, nextId } from "./_db";
import { HEADSHOTS, unsplash } from "@/lib/mock-data/photos";

/**
 * GET /api/users/:id
 * 200 -> User
 * 404 -> null
 * Used on: /caretaker/[id], /booking/[id], /dashboard, profile headers
 */
export async function getUserById(id: string): Promise<User | null> {
  const user = db.users.find((u) => u.id === id) ?? null;
  return delay(user);
}

/**
 * GET /api/users?ids=a,b,c
 * 200 -> User[]  (order not guaranteed; caller maps by id)
 * Used on: dashboards and lists that need to resolve several users at once
 */
export async function getUsersByIds(ids: string[]): Promise<User[]> {
  const set = new Set(ids);
  return delay(db.users.filter((u) => set.has(u.id)));
}

/**
 * GET /api/users  (dev/demo only — the account switcher lists selectable users)
 * 200 -> User[]
 * Used on: DevAccountSwitcher
 */
export async function listUsers(): Promise<User[]> {
  return delay(db.users.map((u) => ({ ...u })));
}

/**
 * POST /api/users   (mock signup — a real build delegates to the auth provider)
 * Body: { name; email; phone?; roles? }
 * 201 -> User
 * Used on: /signup
 */
export async function createUser(input: {
  name: string;
  email: string;
  phone?: string;
  roles?: UserRole[];
}): Promise<User> {
  const user: User = {
    id: nextId("u"),
    name: input.name,
    email: input.email,
    phone: input.phone ?? "",
    avatarUrl: unsplash(HEADSHOTS[db.users.length % HEADSHOTS.length], 240, 240, "faces"),
    roles: input.roles ?? [],
    address: { city: "Austin", state: "TX", lat: 30.2672, lng: -97.7431 },
    verified: false,
    createdAt: "2026-07-08T12:00:00Z",
  };
  db.users.push(user);
  return delay(user);
}

/**
 * PATCH /api/users/:id
 * Body: Partial<User>
 * 200 -> User
 * Used on: onboarding (role selection), profile edits
 */
export async function updateUser(
  id: string,
  patch: Partial<User>
): Promise<User> {
  const user = db.users.find((u) => u.id === id);
  if (!user) throw new Error(`User ${id} not found`);
  Object.assign(user, patch);
  return delay({ ...user });
}
