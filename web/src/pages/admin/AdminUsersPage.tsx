import { Link } from "react-router";
import { useState } from "react";
import type { AdminUserSummary, StaffRole, UserRole } from "@/types";
import { searchAdminUsers } from "@/api/admin";
import { useAsync } from "@/hooks/useAsync";
import { useCursorPager } from "@/hooks/useCursorPager";
import { useSession } from "@/store/session";
import { ApiError } from "@/api/_client";
import { AdminShell } from "@/components/admin/AdminShell";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { SelectFilter } from "@/components/ui/SelectFilter";
import { Skeleton } from "@/components/ui/Skeleton";
import { BLUR_DATA_URL } from "@/lib/photos";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_OPTIONS,
  ACCOUNT_STATUS_TONE,
  ROLE_LABELS,
  ROLE_OPTIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_OPTIONS,
  formatDate,
} from "@/lib/utils";

/**
 * The user list.
 *
 * Filtering, counting and paging all happen in Postgres — the same approach
 * `StoreCatalog` takes over the same envelope. The one detail worth copying
 * deliberately is `onFilter`, which resets the page to zero: changing a filter
 * while on page 4 of the old result set otherwise lands you on an empty page
 * and looks like a bug in the filter.
 */

const PAGE_SIZE = 25;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name (A–Z)" },
  { value: "recent_login", label: "Recently active" },
] as const;

function AuthChips({ methods }: { methods: AdminUserSummary["authMethods"] }) {
  if (methods.length === 0) {
    // Neither credential: an account that can only be reached by a reset link.
    return <span className="font-mono text-[10px] text-charcoal/40">no sign-in</span>;
  }
  return (
    <span className="font-mono text-[10px] uppercase text-charcoal/45">
      {methods.join(" · ")}
    </span>
  );
}

export default function AdminUsersPage() {
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);

  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [staffRole, setStaffRole] = useState("");
  const [status, setStatus] = useState("");
  const [authMethod, setAuthMethod] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("newest");
  const pager = useCursorPager();
  const page = pager.page;

  /** Any filter change starts again at the first page. */
  function onFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      pager.reset();
    };
  }

  const { data, loading } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await searchAdminUsers({
        q: q.trim() || undefined,
        role: (role || undefined) as UserRole | undefined,
        staffRole: (staffRole || undefined) as StaffRole | undefined,
        status: (status || undefined) as "active" | "suspended" | "deleted" | undefined,
        authMethod: (authMethod || undefined) as "password" | "google" | undefined,
        sort,
        limit: PAGE_SIZE,
        cursor: pager.cursor,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return null;
      }
      throw e;
    }
  }, [currentUser?.id, q, role, staffRole, status, authMethod, sort, pager.cursor]);

  const total = data?.total ?? 0;
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <AdminShell
      title="Users"
      lede="Every account on the platform, and what it can do."
      denied={denied}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Field label="Search" htmlFor="admin-user-q">
            <Input
              id="admin-user-q"
              value={q}
              onChange={(e) => onFilter(setQ)(e.target.value)}
              placeholder="Name, email, or id"
            />
          </Field>
          <SelectFilter
            id="admin-user-status"
            label="Status"
            anyLabel="Any status"
            options={ACCOUNT_STATUS_OPTIONS}
            optionLabel={(s) => ACCOUNT_STATUS_LABELS[s]}
            value={status}
            onChange={onFilter(setStatus)}
          />
          <SelectFilter
            id="admin-user-role"
            label="Marketplace role"
            anyLabel="Any role"
            options={ROLE_OPTIONS}
            optionLabel={(r) => ROLE_LABELS[r]}
            value={role}
            onChange={onFilter(setRole)}
          />
          <SelectFilter
            id="admin-user-staff"
            label="Staff access"
            anyLabel="Anyone"
            options={STAFF_ROLE_OPTIONS}
            optionLabel={(r) => STAFF_ROLE_LABELS[r]}
            value={staffRole}
            onChange={onFilter(setStaffRole)}
          />
          <SelectFilter
            id="admin-user-auth"
            label="Signs in with"
            anyLabel="Either"
            options={["password", "google"] as const}
            optionLabel={(m) => (m === "password" ? "Password" : "Google")}
            value={authMethod}
            onChange={onFilter(setAuthMethod)}
          />
          <button
            type="button"
            onClick={() => {
              setQ("");
              setRole("");
              setStaffRole("");
              setStatus("");
              setAuthMethod("");
              pager.reset();
            }}
            className="text-xs text-charcoal/55 hover:text-ink hover:underline"
          >
            Reset filters
          </button>
        </aside>

        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-sm text-charcoal/60">
              {total} account{total === 1 ? "" : "s"}
            </p>
            <label className="flex items-center gap-2 text-xs text-charcoal/55">
              Sort
              <select
                value={sort}
                aria-label="Sort users"
                onChange={(e) =>
                  onFilter(setSort)(e.target.value as (typeof SORTS)[number]["value"])
                }
                className="rounded-lg border border-mist bg-white px-2 py-1.5 text-sm text-ink"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : total === 0 ? (
            <EmptyState
              title="No accounts match"
              description="Try widening the filters, or clearing the search."
            />
          ) : (
            <ul className="space-y-2">
              {(data?.items ?? []).map((u) => (
                <li key={u.id}>
                  <Link
                    to={`/dashboard/admin/users/${u.id}`}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-mist bg-white px-3 py-2.5 transition-colors hover:border-ink/40"
                  >
                    <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-fog">
                      {u.avatarUrl && (
                        <img
                          src={u.avatarUrl}
                          alt=""
                          width={36}
                          height={36}
                          loading="lazy"
                          decoding="async"
                          style={{ backgroundImage: `url("${BLUR_DATA_URL}")`, backgroundSize: "cover" }}
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink">{u.name}</span>
                        {!u.verified && u.status === "active" && (
                          <StatusBadge tone="pending" label="Unverified" />
                        )}
                        {u.status !== "active" && (
                          <StatusBadge
                            tone={ACCOUNT_STATUS_TONE[u.status]}
                            label={ACCOUNT_STATUS_LABELS[u.status]}
                          />
                        )}
                        {u.staffRoles.map((r) => (
                          <StatusBadge
                            key={r}
                            tone="active"
                            label={STAFF_ROLE_LABELS[r]}
                          />
                        ))}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-charcoal/60">
                        {u.email}
                        {u.roles.length > 0 &&
                          ` · ${u.roles.map((r) => ROLE_LABELS[r]).join(", ")}`}
                        {u.city && ` · ${u.city}, ${u.state}`}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <AuthChips methods={u.authMethods} />
                      <span className="block font-mono text-[10px] text-charcoal/45">
                        {u.lastLoginAt
                          ? `seen ${formatDate(u.lastLoginAt)}`
                          : `joined ${formatDate(u.createdAt)}`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={pager.prev}
              >
                Previous
              </Button>
              <span className="font-mono text-xs text-charcoal/55">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!data?.nextCursor}
                onClick={() => pager.next(data?.nextCursor)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
