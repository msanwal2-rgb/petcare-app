import { getJson } from "./_client";

/**
 * Distinct brands across the active catalogue. Powers the store's brand filter.
 *
 * One file per domain, and pages call ONLY these — never `fetch` directly. That
 * rule is what kept the reference project's frontend portable enough to move
 * here with two lines changed, and it is worth keeping for the same reason.
 */
export function listBrands(): Promise<string[]> {
  return getJson<string[]>("/brands");
}
