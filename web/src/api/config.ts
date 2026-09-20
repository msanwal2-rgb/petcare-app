import { getJson } from "./_client";
import type { PublicConfig } from "@/types";

/**
 * Public runtime configuration. See ./users.ts for the conventions this file
 * follows.
 */
export function getPublicConfig(): Promise<PublicConfig> {
  return getJson<PublicConfig>("/config");
}
