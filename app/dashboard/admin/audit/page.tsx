"use client";

import Link from "next/link";
import { useState } from "react";
import { getAuditLog } from "@/lib/api/admin";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { ApiError } from "@/lib/api/_client";
import { AdminShell } from "@/components/admin/AdminShell";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/utils";

/**
 * What staff have done.
 *
 * Append-only and unfiltered by default, because the value of an audit log is
 * that it shows you the thing you weren't looking for. The filters are for
 * following a thread once you have one.
 */

const PAGE_SIZE = 50;

export default function AdminAuditPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [actor, setActor] = useState("");
  const [target, setTarget] = useState("");
  const [page, setPage] = useState(0);

  const { data, loading } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await getAuditLog({
        actorUserId: actor.trim() || undefined,
        targetId: target.trim() || undefined,
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
  }, [currentUser?.id, actor, target, page]);

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminShell
      title="Audit log"
      lede="Every privileged action, who took it, and when."
      denied={denied}
    >
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Field label="Actor (user id)" htmlFor="audit-actor">
          <Input
            id="audit-actor"
            value={actor}
            onChange={(e) => {
              setActor(e.target.value);
              setPage(0);
            }}
            placeholder="u21"
          />
        </Field>
        <Field label="Target id" htmlFor="audit-target">
          <Input
            id="audit-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setPage(0);
            }}
            placeholder="u7"
          />
        </Field>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          description="Administrative actions appear here as they happen."
        />
      ) : (
        <>
          <p className="mb-3 font-mono text-sm text-charcoal/60">
            {total} entr{total === 1 ? "y" : "ies"}
          </p>
          <ul className="space-y-2">
            {(data?.items ?? []).map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-mist bg-white px-3 py-2.5"
              >
                <span className="font-mono text-[10px] uppercase tracking-wide text-leash">
                  {entry.action}
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink">
                  {entry.summary}
                </span>
                <span className="font-mono text-xs text-charcoal/55">
                  <Link
                    href={`/dashboard/admin/users/${entry.actorUserId}`}
                    className="hover:underline"
                  >
                    {entry.actorName}
                  </Link>{" "}
                  · {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>

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
