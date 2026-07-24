"use client";

/**
 * Mounted once in the root layout. On load it reconciles the client store with
 * the real Auth.js session (via /api/me), so a page refresh restores the
 * signed-in user and `hasHydrated` flips true once the check completes.
 */

import { useEffect } from "react";
import { refreshSessionUser } from "@/lib/auth/session-client";

export function SessionSync() {
  useEffect(() => {
    void refreshSessionUser();
  }, []);
  return null;
}
