import { ok } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { getMembership } from "@/lib/server/entitlements";
import { getPlanByKey } from "@/lib/server/subscriptions";
import type { MembershipView } from "@/types";

/** The one plan this app sells. */
export const PLAN_KEY = "leash_plus";

// GET /api/membership -> MembershipView
//
// What the customer is entitled to, and what they could buy. Read from the
// database on every call rather than cached in the session — see
// lib/server/entitlements.ts for why membership is never a token claim.
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const [membership, plan] = await Promise.all([
    getMembership(auth.uid),
    getPlanByKey(PLAN_KEY),
  ]);

  const view: MembershipView = { membership, plan };
  return ok(view);
}
