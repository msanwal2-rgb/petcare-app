"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getMembership, startMembershipCheckout } from "@/lib/api/membership";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/ui/Reveal";
import { TruckIcon, StethoscopeIcon, ClockIcon } from "@/components/ui/icons";
import { formatCents } from "@/lib/utils";
import { LEAD_TIME_HOURS } from "@/lib/booking-priority";

/**
 * Leash Plus.
 *
 * Every claim on this page is enforced somewhere in the server: free shipping
 * in `quoteCart`, the consult discount in `createAppointment`, the lead time in
 * both. Nothing here is a badge.
 */
const BENEFITS = [
  {
    icon: TruckIcon,
    title: "Free delivery, whatever's in the basket",
    body: "No threshold to reach and no minimum order. The shipping line is simply zero.",
  },
  {
    icon: StethoscopeIcon,
    title: "20% off every vet consultation",
    body: "Applied when you book, to the vet's own fee — in clinic, by video, or at home.",
  },
  {
    icon: ClockIcon,
    title: "Same-day booking",
    body: `Members can request an appointment ${LEAD_TIME_HOURS.member} hours out. Everyone else has to ask ${LEAD_TIME_HOURS.standard} hours ahead.`,
  },
];

export default function PlusPage() {
  const { currentUser, hasHydrated } = useSession();
  const [busy, setBusy] = useState(false);

  const { data } = useAsync(
    async () => (currentUser ? getMembership() : null),
    [currentUser?.id]
  );

  const plan = data?.plan ?? null;
  const alreadyMember = data?.membership.active ?? false;

  async function subscribe() {
    setBusy(true);
    try {
      const { url } = await startMembershipCheckout();
      // A full document load, not a router push: this leaves our origin.
      window.location.href = url;
    } catch (e) {
      toast.error("We couldn't start that", {
        description: e instanceof Error ? e.message : undefined,
      });
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <Reveal>
        <p className="font-mono text-xs uppercase tracking-widest text-leash">
          Membership
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Leash Plus
        </h1>
        <p className="mt-3 max-w-xl text-charcoal/70">
          One membership across the whole of Leash — the store, the vets, and the
          caretakers. Cancel whenever you like; it runs to the end of the month
          you&apos;ve paid for.
        </p>
      </Reveal>

      <Reveal delay={0.08}>
        <div className="mt-8 rounded-2xl border border-mist bg-white p-6">
          {!hasHydrated ? (
            <Skeleton className="h-10 w-40" />
          ) : (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-3xl font-semibold text-ink">
                  {plan ? formatCents(plan.priceCents) : "—"}
                  <span className="ml-1 text-sm font-normal text-charcoal/55">
                    / {plan?.interval ?? "month"}
                  </span>
                </p>
                {plan && !plan.purchasable && (
                  <p className="mt-1 text-xs text-charcoal/55">
                    Not open for new members just now.
                  </p>
                )}
              </div>

              {!currentUser ? (
                <ButtonLink href="/login?callbackUrl=%2Fplus" variant="cta">
                  Sign in to join
                </ButtonLink>
              ) : alreadyMember ? (
                <ButtonLink href="/account/membership" variant="outline">
                  You&apos;re a member
                </ButtonLink>
              ) : (
                <Button
                  variant="cta"
                  disabled={busy || !plan?.purchasable}
                  onClick={subscribe}
                >
                  {busy ? "Opening checkout…" : "Join Leash Plus"}
                </Button>
              )}
            </div>
          )}
        </div>
      </Reveal>

      <div className="mt-8 space-y-3">
        {BENEFITS.map((benefit, i) => (
          <Reveal key={benefit.title} delay={0.12 + i * 0.06}>
            <div className="flex gap-4 rounded-2xl border border-mist bg-white p-5">
              <span className="mt-0.5 shrink-0 text-ink">
                <benefit.icon width={22} height={22} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-ink">{benefit.title}</h2>
                <p className="mt-1 text-sm text-charcoal/70">{benefit.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <p className="mt-8 text-xs text-charcoal/55">
        Billed monthly. Card details are handled by our payment provider and
        never reach Leash. See the{" "}
        <Link href="/support" className="underline hover:text-ink">
          support pages
        </Link>{" "}
        for cancellation and refund terms.
      </p>
    </div>
  );
}
