import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  cancelMembership,
  getMembership,
  openBillingPortal,
  resumeMembership,
  syncMembership,
} from "@/api/membership";
import { useAsync } from "@/hooks/useAsync";
import { useSession } from "@/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Panel, Stat } from "@/components/ui/Panel";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCents, formatDate } from "@/lib/utils";
import type { SubscriptionStatus } from "@/types";

/**
 * The member's own view of their membership.
 *
 * After a checkout redirect the subscription may not exist yet — the redirect
 * is not the truth, the webhook is. So arriving with `?checkout=success` puts
 * the page into a short polling state rather than showing "you're not a member"
 * to somebody who just paid.
 */

const STATUS_TONE: Record<SubscriptionStatus, StatusTone> = {
  active: "done",
  trialing: "active",
  past_due: "pending",
  unpaid: "failed",
  incomplete: "pending",
  incomplete_expired: "muted",
  canceled: "muted",
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  unpaid: "Unpaid",
  incomplete: "Awaiting payment",
  incomplete_expired: "Expired",
  canceled: "Ended",
};

export default function MembershipPage() {
  const { currentUser, hasHydrated } = useSession();
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("checkout") === "success";
  });

  const { data, loading, reload } = useAsync(
    async () => (currentUser ? getMembership() : null),
    [currentUser?.id]
  );

  const active = data?.membership.active ?? false;

  // Derived, not assigned: React 19 forbids setting state directly in an
  // effect body, and "are we still waiting?" is a function of two things we
  // already have.
  const waiting = settling && !active;

  // Poll while a just-completed checkout catches up. Bounded: after a handful
  // of attempts we stop and let them refresh, rather than spinning forever on
  // a webhook that is never coming.
  useEffect(() => {
    if (!waiting) return;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      try {
        await syncMembership();
      } catch {
        /* the reload below will show whatever state we do have */
      }
      reload();
      if (attempts >= 5) {
        setSettling(false);
        clearInterval(timer);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      reload();
    } catch (e) {
      toast.error("That didn't work", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function portal() {
    setBusy(true);
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (e) {
      toast.error("We couldn't open your billing settings", {
        description: e instanceof Error ? e.message : undefined,
      });
      setBusy(false);
    }
  }

  if (!hasHydrated || loading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) return <AuthRequired message="Log in to manage your membership." />;

  const membership = data?.membership;
  const plan = data?.plan;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">Account</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        Membership
      </h1>

      {waiting ? (
        <div className="mt-6 rounded-2xl border border-mist bg-white p-6">
          <p className="text-sm text-charcoal/70">
            Thanks — we&apos;re confirming your payment with our provider. This
            usually takes a few seconds.
          </p>
          <Skeleton className="mt-4 h-6 w-40" />
        </div>
      ) : !membership?.active ? (
        <div className="mt-6">
          <EmptyState
            title="You're not a member"
            description={
              plan
                ? `Leash Plus is ${formatCents(plan.priceCents)} a month: free delivery, ${plan.consultDiscountPct}% off vet consultations, and same-day booking.`
                : "Leash Plus gets you free delivery, a discount on vet consultations, and same-day booking."
            }
            actionLabel="See what's included"
            actionHref="/plus"
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-mist bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">
                {membership.planName ?? "Leash Plus"}
              </h2>
              {membership.status && (
                <StatusBadge
                  tone={STATUS_TONE[membership.status]}
                  label={STATUS_LABEL[membership.status]}
                />
              )}
              {membership.cancelAtPeriodEnd && (
                <StatusBadge tone="muted" label="Ends at period end" />
              )}
            </div>

            {membership.inGrace && (
              <p className="mt-3 rounded-xl border border-marigold/40 bg-marigold/10 px-3 py-2 text-sm text-charcoal">
                We couldn&apos;t take your last payment. Your benefits continue
                while we retry — updating your card keeps them.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat
                label={membership.cancelAtPeriodEnd ? "Ends" : "Renews"}
                value={
                  membership.currentPeriodEnd
                    ? formatDate(membership.currentPeriodEnd)
                    : "—"
                }
              />
              <Stat
                label="Consultation discount"
                value={`${membership.consultDiscountPct}%`}
              />
            </div>
          </div>

          <Panel title="Billing">
            <p className="mb-3 text-sm text-charcoal/70">
              Cards, receipts and invoice history live with our payment
              provider. We never see or store your card.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={portal}>
                Manage billing
              </Button>

              {membership.cancelAtPeriodEnd ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => run("Membership resumed", resumeMembership)}
                >
                  Keep my membership
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Cancel Leash Plus?\n\nYou'll keep every benefit until the end of the month you've already paid for."
                      )
                    )
                      return;
                    run("Membership will end at the period end", cancelMembership);
                  }}
                >
                  Cancel membership
                </Button>
              )}
            </div>
          </Panel>

          <ButtonLink to="/plus" variant="ghost" size="sm">
            What&apos;s included →
          </ButtonLink>
        </div>
      )}
    </div>
  );
}
