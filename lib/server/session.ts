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
import { prisma } from "@/lib/db/prisma";
import { forbidden, unauthorized } from "./http";
import { hasStaffRole, type StaffRole } from "./access";

// Re-exported so route handlers can pull auth guards + response helpers from a
// single import site.
export { unauthorized, forbidden };

/**
 * The signed-in user's id, or a ready-made 401 — same either/or shape as
 * `parseBody`, so a handler opens with two lines instead of four:
 *
 *   const auth = await requireUser();
 *   if ("response" in auth) return auth.response;
 *
 * This is also where a session gets *revoked*. Auth.js is configured with JWT
 * sessions and no database adapter, so there is no session table to delete a
 * row from: a cookie stays valid for its full lifetime no matter what happens
 * to the account behind it. Suspending someone, or resetting a password after a
 * compromise, has to mean something before the token expires — so the account
 * is re-checked here, at the one point every authenticated request passes
 * through. The cost is a single indexed primary-key lookup; every route that
 * calls this already makes several queries of its own.
 */
export async function requireUser(): Promise<
  { uid: string } | { response: Response }
> {
  const session = await auth();
  const uid = session?.user?.id;
  if (!uid) return { response: unauthorized() };

  const account = await prisma.user.findUnique({
    where: { id: uid },
    select: { status: true, sessionsValidFrom: true },
  });

  // The row is gone, or the account is no longer allowed to act. Deliberately
  // a 401 rather than a 403: the correct client response is to sign out, not to
  // retry with the same cookie.
  if (!account || account.status !== "active") {
    return { response: unauthorized("Your account is not active") };
  }

  // Tokens minted before this instant are refused. `issuedAt` is the JWT's own
  // `iat` claim, copied onto the session in auth.config.ts — reading it there
  // keeps this comparison possible without a database call in the edge-safe
  // config that proxy.ts loads.
  if (account.sessionsValidFrom) {
    const issuedAt = session?.user?.issuedAt;
    const validFrom = Date.parse(account.sessionsValidFrom);
    if (!issuedAt || Number.isNaN(validFrom) || issuedAt * 1000 < validFrom) {
      return { response: unauthorized("Please sign in again") };
    }
  }

  return { uid };
}

/**
 * The signed-in user's id, or a 401/403 — for endpoints only staff may reach.
 *
 * Same either/or shape as `requireUser`, and it composes with it rather than
 * duplicating it, so the account-status and revocation checks above apply to
 * staff too. A suspended admin is not an admin.
 */
export async function requireStaff(
  role: StaffRole,
): Promise<{ uid: string } | { response: Response }> {
  const authed = await requireUser();
  if ("response" in authed) return authed;
  if (!(await hasStaffRole(authed.uid, role))) {
    // 403, not 404: the caller is a known user being told no. Admin route
    // *existence* is not a secret worth protecting — the access is.
    return { response: forbidden() };
  }
  return { uid: authed.uid };
}

/**
 * The authorization predicates live in ./access, which deliberately imports
 * nothing from Auth.js — that is what lets the unit suite exercise them. They
 * are re-exported here because this is the single import site route handlers
 * have always used, and there is no reason to churn twenty of them.
 */
export {
  STAFF_ROLES,
  isStaffRole,
  staffRoles,
  hasStaffRole,
  isOps,
  isBookingParticipant,
  ownsCaretakerProfile,
  ownsVetProfile,
  ownsPet,
  canViewPet,
  isAppointmentParticipant,
  canAccessPetRecords,
} from "./access";
export type { StaffRole } from "./access";
