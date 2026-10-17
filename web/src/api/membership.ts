/**
 * Membership — API client. See ./users.ts for the pattern.
 */

import { getJson, postJson } from "./_client";
import type { Membership, MembershipView } from "@/types";

/** GET /membership -> MembershipView */
export function getMembership(): Promise<MembershipView> {
  return getJson<MembershipView>("/membership");
}

/**
 * POST /membership/checkout -> { url } — send the browser to it. On Stripe it
 * is the hosted checkout; on the demo provider the membership has already
 * started and the url is the membership page.
 */
export function startMembershipCheckout(): Promise<{ url: string }> {
  return postJson<{ url: string }>("/membership/checkout", {});
}

/** POST /membership/cancel -> { ok, endsAt } — cancels at period end. */
export function cancelMembership(): Promise<{ ok: boolean; endsAt: string }> {
  return postJson<{ ok: boolean; endsAt: string }>("/membership/cancel", {});
}

/** POST /membership/resume -> { ok } */
export function resumeMembership(): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>("/membership/resume", {});
}

/** POST /membership/portal -> { url } — the provider's billing portal. 503 on the demo provider. */
export function openBillingPortal(): Promise<{ url: string }> {
  return postJson<{ url: string }>("/membership/portal", {});
}

/** POST /membership/sync -> Membership — for a slow or lost webhook. */
export function syncMembership(): Promise<Membership> {
  return postJson<Membership>("/membership/sync", {});
}
