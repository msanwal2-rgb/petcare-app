/**
 * Server-side session helpers used by route handlers to enforce authorization.
 * The real security boundary lives here (not in the client store): every write
 * endpoint checks the Auth.js session before touching data.
 *
 * This file answers "who is calling?". The predicates that answer "may they
 * touch this record?" live in ./access and are re-exported at the bottom, so a
 * route handler still reaches for both from one import.
 */

import { auth } from "@/auth";
import { forbidden, unauthorized } from "./http";

// Re-exported so route handlers can pull auth guards + response helpers from a
// single import site.
export { unauthorized, forbidden };

/** The authenticated user's id, or null. Route handlers use requireUser. */
async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * The signed-in user's id, or a ready-made 401 — same either/or shape as
 * `parseBody`, so a handler opens with two lines instead of four:
 *
 *   const auth = await requireUser();
 *   if ("response" in auth) return auth.response;
 */
export async function requireUser(): Promise<
  { uid: string } | { response: Response }
> {
  const uid = await currentUserId();
  return uid ? { uid } : { response: unauthorized() };
}

/**
 * The authorization predicates live in ./access, which deliberately imports
 * nothing from Auth.js — that is what lets the unit suite exercise them. They
 * are re-exported here because this is the single import site route handlers
 * have always used, and there is no reason to churn twenty of them.
 */
export {
  isOps,
  isBookingParticipant,
  ownsCaretakerProfile,
  ownsVetProfile,
  ownsPet,
  isAppointmentParticipant,
  canAccessPetRecords,
} from "./access";
