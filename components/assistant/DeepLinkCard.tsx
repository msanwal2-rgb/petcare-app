"use client";

/**
 * A deep link, rendered as the button it is.
 *
 * This is the visible half of the decision that the assistant proposes actions
 * rather than taking them. When it says "I've opened the form with the dates
 * filled in", this is the form — and pressing it is the customer's act, not the
 * bot's.
 */

import { ButtonLink } from "@/components/ui/Button";

export interface DeepLinkPayload {
  kind: "deep_link";
  href: string;
  label: string;
  summary: string;
}

export function isDeepLink(value: unknown): value is DeepLinkPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "deep_link"
  );
}

export function DeepLinkCard({ link }: { link: DeepLinkPayload }) {
  return (
    <div className="mt-2 rounded-xl border border-mist bg-fog/50 p-3">
      <p className="text-sm text-charcoal/80">{link.summary}</p>
      <ButtonLink href={link.href} variant="cta" size="sm" className="mt-2.5">
        {link.label}
      </ButtonLink>
    </div>
  );
}
