/**
 * In-memory mock database.
 *
 * Seeded once from /lib/mock-data, then mutated in place so that actions taken
 * during a session (request a booking, accept it, add a pet) are reflected on
 * subsequent reads — exactly what a real backend would do. This is the ONLY
 * module that touches the raw seed data; every domain file in /lib/api reads
 * and writes through here.
 *
 * When a real API is wired up, delete this file and the mock branches in each
 * domain file; the exported function signatures stay identical.
 */

import {
  bookings as seedBookings,
  caretakers as seedCaretakers,
  pets as seedPets,
  reviews as seedReviews,
  users as seedUsers,
} from "@/lib/mock-data";
import type { Booking, CaretakerProfile, Pet, Review, User } from "@/types";

// Deep-ish clones so mutations never corrupt the original seed modules.
export const db = {
  users: seedUsers.map((u) => ({ ...u })) as User[],
  pets: seedPets.map((p) => ({ ...p })) as Pet[],
  caretakers: seedCaretakers.map((c) => ({ ...c })) as CaretakerProfile[],
  bookings: seedBookings.map((b) => ({ ...b })) as Booking[],
  reviews: seedReviews.map((r) => ({ ...r })) as Review[],
};

/** Simulate realistic network latency (brief §7: ~400–800ms). */
export function delay<T>(value: T, ms?: number): Promise<T> {
  const deterministicJitter = ((value ? 1 : 0) + 400) as number; // avoid Math.random for SSR stability
  const wait = ms ?? deterministicJitter + 200; // ~600ms default
  return new Promise((resolve) => setTimeout(() => resolve(value), wait));
}

/** Monotonic-ish id generator for created records (session-scoped). */
let counter = 1000;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}
