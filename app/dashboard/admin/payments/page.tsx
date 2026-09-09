"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import type { AdminPaymentRow, PaymentStatus } from "@/types";
import { refundPayment, searchPayments } from "@/lib/api/admin";
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
import { formatCents, formatDateTime } from "@/lib/utils";

/**
 * The money.
 *
 * Every row here is a `Payment` in the ledger, and the refund button is the
 * same `requestRefund` a cancellation calls — so a refund issued from this
 * screen, from a cancelled order, and from the Stripe dashboard all end in the
 * same place.
 */

const PAGE_SIZE = 25;

const STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  unpaid: "muted",
  pending: "pending",
  requires_action: "pending",
  processing: "progress",
  authorized: "active",
  paid: "done",
  partially_refunded: "pending",
  refunded: "muted",
  failed: "failed",
  disputed: "failed",
};

const STATUS_OPTIONS: PaymentStatus[] = [
  "paid",
  "pending",
  "requires_action",
  "processing",
  "partially_refunded",
  "refunded",
  "failed",
  "disputed",
];

const label = (s: string) => s.replace(/_/g, " ");

function PaymentRow({
  payment,
  busy,
  onRefund,
}: {
  payment: AdminPaymentRow;
  busy: boolean;
  onRefund: (p: AdminPaymentRow) => void;
}) {
  const remaining = payment.amountCents - payment.amountRefundedCents;
  const refundable =
    remaining > 0 &&
    ["paid", "partially_refunded", "authorized", "disputed"].includes(payment.status);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium text-ink">
            {formatCents(payment.amountCents)}
          </span>
          <StatusBadge
            tone={STATUS_TONE[payment.status]}
            label={label(payment.status)}
          />
          {payment.kind === "subscription_invoice" && (
            <StatusBadge tone="active" label="Membership" />
          )}
          {payment.amountRefundedCents > 0 && (
            <span className="font-mono text-xs text-charcoal/55">
              −{formatCents(payment.amountRefundedCents)} refunded
            </span>
          )}
        </div>

        <p className="mt-1 truncate text-sm text-charcoal/70">
          <Link
            href={`/dashboard/admin/users/${payment.userId}`}
            className="hover:underline"
          >
            {payment.userName}
          </Link>{" "}
          · {payment.userEmail}
          {payment.orderId && (
            <>
              {" · "}
              <Link
                href={`/store/orders/${payment.orderId}`}
                className="font-mono hover:underline"
              >
                {payment.orderId}
              </Link>
            </>
          )}
        </p>

        <p className="font-mono text-xs text-charcoal/50">
          {payment.providerRef} · {payment.provider}
          {payment.methodLast4 && ` · ${payment.methodBrand} ••${payment.methodLast4}`}
          {" · "}
          {formatDateTime(payment.createdAt)}
        </p>

        {payment.failureMessage && (
          <p className="mt-1 text-xs text-leash">{payment.failureMessage}</p>
        )}
      </div>

      {refundable && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRefund(payment)}>
          Refund
        </Button>
      )}
    </div>
  );
}

export default function AdminPaymentsPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  const { data, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await searchPayments({
        q: q.trim() || undefined,
        status: (status || undefined) as PaymentStatus | undefined,
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

  async function refund(payment: AdminPaymentRow) {
    const remaining = payment.amountCents - payment.amountRefundedCents;
    const raw = window.prompt(
      `Refund how much, in cents? Up to ${remaining} (${formatCents(remaining)}).`,
      String(remaining)
    );
    if (!raw) return;
    const amountCents = Number(raw.replace(/\D/g, ""));
    if (!amountCents) return;

    const note = window.prompt("A note for the audit log (optional):") ?? "";

    setBusyId(payment.id);
    try {
      await refundPayment(payment.id, { amountCents, note });
      toast.success(`Refunded ${formatCents(amountCents)}`);
      reload();
    } catch (e) {
      toast.error("Couldn't refund that", {
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
      title="Payments"
      lede="Every charge, refund and membership invoice."
      denied={denied}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-[1fr_200px] lg:max-w-2xl">
        <Field label="Search" htmlFor="pay-q">
          <Input
            id="pay-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Reference, order id, or email"
          />
        </Field>
        <SelectFilter
          id="pay-status"
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
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Payments" value={String(total)} />
            <Stat label="Captured" value={formatCents(data?.capturedCents ?? 0)} />
            <Stat label="Refunded" value={formatCents(data?.refundedCents ?? 0)} />
            <Stat
              label="Net"
              value={formatCents(
                (data?.capturedCents ?? 0) - (data?.refundedCents ?? 0)
              )}
            />
          </div>

          {total === 0 ? (
            <EmptyState
              title="No payments match"
              description="Try clearing the search, or widening the status filter."
            />
          ) : (
            <div className="space-y-3">
              {(data?.items ?? []).map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  busy={busyId === p.id}
                  onRefund={refund}
                />
              ))}
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
