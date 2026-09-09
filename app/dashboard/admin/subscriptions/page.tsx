"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { SubscriptionStatus } from "@/types";
import { cancelSubscription, extendGrace, searchSubscriptions } from "@/lib/api/admin";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { ApiError } from "@/lib/api/_client";
import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { Stat } from "@/components/ui/Panel";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatCents, formatDate } from "@/lib/utils";

/** Members, and the two things support is ever asked to do about one. */
const PAGE_SIZE = 25;

const TONE: Record<SubscriptionStatus, StatusTone> = {
  active: "done",
  trialing: "active",
  past_due: "pending",
  unpaid: "failed",
  incomplete: "pending",
  incomplete_expired: "muted",
  canceled: "muted",
};

const STATUS_OPTIONS: SubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
];

const label = (s: string) => s.replace(/_/g, " ");

export default function AdminSubscriptionsPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  const { data, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await searchSubscriptions({
        q: q.trim() || undefined,
        status: (status || undefined) as SubscriptionStatus | undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return null;
      }
      throw e;
    }
  }, [currentUser?.id, q, status, page]);

  async function run(id: string, label: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await fn();
      toast.success(label);
      reload();
    } catch (e) {
      toast.error("That didn't work", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  }

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminShell
      title="Memberships"
      lede="Who is subscribed, and what state their billing is in."
      denied={denied}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_200px] lg:max-w-2xl">
        <Field label="Search" htmlFor="sub-q">
          <Input
            id="sub-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Email or subscription reference"
          />
        </Field>
        <SelectFilter
          id="sub-status"
          label="Status"
          anyLabel="Any status"
          options={STATUS_OPTIONS}
          optionLabel={label}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Subscriptions" value={String(total)} />
            <Stat label="Active members" value={String(data?.activeCount ?? 0)} />
            <Stat label="Monthly revenue" value={formatCents(data?.mrrCents ?? 0)} />
          </div>

          {total === 0 ? (
            <EmptyState
              title="No memberships match"
              description="Nobody has subscribed yet, or the filters are too narrow."
            />
          ) : (
            <div className="space-y-3">
              {(data?.items ?? []).map((s) => {
                const live = ["active", "trialing", "past_due"].includes(s.status);
                return (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/admin/users/${s.userId}`}
                          className="text-sm font-medium text-ink hover:underline"
                        >
                          {s.userName}
                        </Link>
                        <StatusBadge tone={TONE[s.status]} label={label(s.status)} />
                        {s.cancelAtPeriodEnd && (
                          <StatusBadge tone="muted" label="Ending" />
                        )}
                      </div>
                      <p className="mt-1 truncate text-sm text-charcoal/70">
                        {s.userEmail} · {s.planName} · {formatCents(s.priceCents)}/mo
                      </p>
                      <p className="font-mono text-xs text-charcoal/50">
                        {s.cancelAtPeriodEnd ? "ends" : "renews"}{" "}
                        {formatDate(s.currentPeriodEnd)}
                        {s.graceEndsAt && ` · grace to ${formatDate(s.graceEndsAt)}`}
                        {" · "}
                        {s.providerRef}
                      </p>
                    </div>

                    {live && (
                      <div className="flex flex-wrap gap-2">
                        {s.status === "past_due" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === s.id}
                            onClick={() =>
                              run(s.id, "Grace extended by 7 days", () =>
                                extendGrace(s.id, 7)
                              )
                            }
                          >
                            +7 days grace
                          </Button>
                        )}
                        {!s.cancelAtPeriodEnd && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === s.id}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Cancel ${s.userEmail}'s membership at the end of the period they've paid for?`
                                )
                              )
                                return;
                              run(s.id, "Will end at period end", () =>
                                cancelSubscription(s.id)
                              );
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="font-mono text-xs text-charcoal/55">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
