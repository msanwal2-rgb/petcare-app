import { useEffect } from "react";
import { refreshSessionUser } from "@/auth/session";

/**
 * Mounted once in the app shell. On load it reconciles the client store with
 * the real session (via /api/v1/me), so a page refresh restores the signed-in
 * user and `hasHydrated` flips true once the check completes.
 *
 * Every guard waits on `hasHydrated` rather than on `currentUser`, so a signed-in
 * user reloading a guarded page sees a skeleton for one round trip instead of a
 * flash of "you're not logged in".
 */
export function SessionSync() {
  useEffect(() => {
    void refreshSessionUser();
  }, []);

  return null;
}
