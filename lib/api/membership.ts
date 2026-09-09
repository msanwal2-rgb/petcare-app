/**
 * Membership client. See ./orders.ts for the conventions this file follows.
 */

import { getJson, postJson } from "./_client";
import type { Membership, MembershipView } from "@/types";

/** GET /api/membership -> MembershipView */
export async function getMembership(): Promise<MembershipView> {
  return getJson<MembershipView>("/api/membership");
}

/** POST /api/membership/checkout -> { url } — redirect the browser to it. */
export async function startMembershipCheckout(): Promise<{ url: string }> {
  return postJson<{ url: string }>("/api/membership/checkout", {});
}

/** POST /api/membership/cancel -> { ok, endsAt } — cancels at period end. */
export async function cancelMembership(): Promise<{ ok: boolean; endsAt: string }> {
  return postJson<{ ok: boolean; endsAt: string }>("/api/membership/cancel", {});
}

/** POST /api/membership/resume -> { ok } */
export async function resumeMembership(): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>("/api/membership/resume", {});
}

/** POST /api/membership/portal -> { url } — the provider's billing portal. */
export async function openBillingPortal(): Promise<{ url: string }> {
  return postJson<{ url: string }>("/api/membership/portal", {});
}

/** POST /api/membership/sync -> Membership — for a slow or lost webhook. */
export async function syncMembership(): Promise<Membership> {
  return postJson<Membership>("/api/membership/sync", {});
}
