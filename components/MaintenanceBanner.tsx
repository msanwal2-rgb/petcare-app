"use client";

import { useState } from "react";
import { getPublicConfig } from "@/lib/api/config";
import { useAsync } from "@/lib/hooks/useAsync";

/**
 * The site-wide notice an admin can raise from /dashboard/admin/settings.
 *
 * Renders nothing when there is nothing to say, which is almost always — so it
 * is deliberately cheap: one small public GET, no layout reserved, and no
 * skeleton, because a banner that flashes a placeholder on every page load
 * would be worse than the banner being a beat late.
 *
 * Dismissible per browser, because a message that cannot be got rid of stops
 * being read after the second page.
 */
export function MaintenanceBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data: config } = useAsync(() => getPublicConfig().catch(() => null), []);

  const message = config?.maintenanceBanner?.trim();
  if (!message || dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-marigold/40 bg-marigold/10 px-4 py-2.5 text-sm text-charcoal sm:px-6"
    >
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-charcoal/50 transition-colors hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
