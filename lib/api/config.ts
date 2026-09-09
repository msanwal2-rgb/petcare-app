/**
 * Public runtime configuration. See ./orders.ts for the conventions this file
 * follows.
 */

import { getJson } from "./_client";
import type { PublicConfig } from "@/types";

/** GET /api/config -> PublicConfig */
export async function getPublicConfig(): Promise<PublicConfig> {
  return getJson<PublicConfig>("/api/config");
}
