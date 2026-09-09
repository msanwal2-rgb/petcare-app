import { ok } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";
import type { PublicConfig } from "@/types";

// GET /api/config -> PublicConfig — public, and deliberately so.
//
// Everything here is something the browser is going to find out anyway by
// using the site: whether signups are open, whether a maintenance banner is
// showing, whether the demo accounts are on offer. Nothing that gates access is
// decided from this response; the server re-checks each of them where it
// matters.
export async function GET() {
  const settings = await getSettings();
  const config: PublicConfig = {
    signupsOpen: settings.signupsOpen,
    maintenanceBanner: settings.maintenanceBanner,
    demoLoginVisible: settings.demoLoginVisible,
  };
  return ok(config);
}
