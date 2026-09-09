"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { toast } from "sonner";
import type { VerificationStatus } from "@/types";
import { searchProfessionals, setVerification } from "@/lib/api/admin";
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
import { BLUR_DATA_URL } from "@/lib/media/photos";

/**
 * Trust and safety.
 *
 * `backgroundCheckStatus` has existed since the first migration and nothing has
 * ever written to it — the verified badge on a caretaker card meant only that a
 * seed fixture said so. This is the page that makes it mean something, and the
 * audit log records who decided.
 */

const PAGE_SIZE = 25;

const TONE: Record<VerificationStatus, StatusTone> = {
  verified: "done",
  pending: "pending",
  none: "muted",
};

const LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  pending: "Under review",
  none: "Unverified",
};

const STATUSES: VerificationStatus[] = ["none", "pending", "verified"];

export default function AdminProfessionalsPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);

  const { data, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await searchProfessionals({
        q: q.trim() || undefined,
        kind: (kind || undefined) as "caretaker" | "vet" | undefined,
        status: (status || undefined) as VerificationStatus | undefined,
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
  }, [currentUser?.id, q, kind, status, page]);

  async function decide(
    id: string,
    profKind: "caretaker" | "vet",
    next: VerificationStatus,
    name: string
  ) {
    const note =
      next === "verified"
        ? (window.prompt(`What was checked for ${name}? (recorded in the audit log)`) ?? "")
        : (window.prompt(`Why is ${name} not verified? (recorded in the audit log)`) ?? "");

    setBusyId(id);
    try {
      await setVerification(id, profKind, next, note);
      toast.success(`${name} marked ${LABEL[next].toLowerCase()}`);
      reload();
    } catch (e) {
      toast.error("Couldn't update that", {
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
      title="Professionals"
      lede="Who has been checked, and who is still taking bookings on their own say-so."
      denied={denied}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:max-w-3xl">
        <Field label="Search" htmlFor="prof-q">
          <Input
            id="prof-q"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Name or email"
          />
        </Field>
        <SelectFilter
          id="prof-kind"
          label="Kind"
          anyLabel="Both"
          options={["caretaker", "vet"] as const}
          optionLabel={(k) => (k === "vet" ? "Vets" : "Caretakers")}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPage(0);
          }}
        />
        <SelectFilter
          id="prof-status"
          label="Status"
          anyLabel="Any status"
          options={STATUSES}
          optionLabel={(s) => LABEL[s]}
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
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Profiles" value={String(total)} />
            <Stat label="Awaiting review" value={String(data?.awaitingReview ?? 0)} />
            <Stat
              label="Verified"
              value={String(
                (data?.items ?? []).filter((p) => p.status === "verified").length
              )}
            />
          </div>

          {total === 0 ? (
            <EmptyState
              title="Nothing to review"
              description="Every professional profile matching these filters has been dealt with."
            />
          ) : (
            <div className="space-y-3">
              {(data?.items ?? []).map((p) => (
                <div
                  key={`${p.kind}-${p.id}`}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-4"
                >
                  <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full bg-fog">
                    {p.avatarUrl && (
                      <Image
                        src={p.avatarUrl}
                        alt=""
                        fill
                        sizes="40px"
                        placeholder="blur"
                        blurDataURL={BLUR_DATA_URL}
                        className="object-cover"
                      />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/admin/users/${p.userId}`}
                        className="text-sm font-medium text-ink hover:underline"
                      >
                        {p.userName}
                      </Link>
                      <StatusBadge tone={TONE[p.status]} label={LABEL[p.status]} />
                      <StatusBadge
                        tone="active"
                        label={p.kind === "vet" ? "Vet" : "Caretaker"}
                      />
                    </div>
                    <p className="mt-1 truncate text-sm text-charcoal/70">{p.detail}</p>
                    <p className="font-mono text-xs text-charcoal/50">
                      {p.userEmail} · {p.rating.toFixed(1)}★ from {p.reviewCount}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {p.status !== "verified" && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busyId === p.id}
                        onClick={() => decide(p.id, p.kind, "verified", p.userName)}
                      >
                        Verify
                      </Button>
                    )}
                    {p.status !== "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === p.id}
                        onClick={() => decide(p.id, p.kind, "pending", p.userName)}
                      >
                        Under review
                      </Button>
                    )}
                    {p.status !== "none" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === p.id}
                        onClick={() => decide(p.id, p.kind, "none", p.userName)}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
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
