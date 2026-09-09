"use client";

import Link from "next/link";
import Image from "next/image";
import { use, useState } from "react";
import { toast } from "sonner";
import type { StaffRole, UserRole } from "@/types";
import {
  deleteUser,
  getAdminUser,
  reactivateUser,
  setStaffRoles,
  setUserRoles,
  setUserVerified,
  signOutUser,
  suspendUser,
} from "@/lib/api/admin";
import { useAsync } from "@/lib/hooks/useAsync";
import { useSession } from "@/lib/store/session";
import { ApiError } from "@/lib/api/_client";
import { AdminShell, holdsRole } from "@/components/admin/AdminShell";
import { Panel, Stat } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { ToggleChips, toggleValue } from "@/components/ui/ToggleChips";
import { EmptyState } from "@/components/EmptyState";
import { BLUR_DATA_URL } from "@/lib/media/photos";
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUS_TONE,
  ROLE_LABELS,
  ROLE_OPTIONS,
  STAFF_ROLE_LABELS,
  STAFF_ROLE_OPTIONS,
  formatCents,
  formatDate,
} from "@/lib/utils";

/**
 * One account, and everything support is likely to be asked about it.
 *
 * The actions are deliberately blunt and individually confirmed rather than a
 * form with a Save button: "suspend this person" and "change their name" should
 * not be the same gesture, and an admin console where a mis-click saves five
 * fields at once is how accidents happen.
 */
export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { currentUser } = useSession();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const canAdmin = holdsRole(currentUser?.staffRoles, "admin");
  const isSelf = currentUser?.id === id;

  const { data: user, loading, reload } = useAsync(async () => {
    if (!currentUser) return null;
    try {
      return await getAdminUser(id);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        return null;
      }
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }, [currentUser?.id, id]);

  /** Every mutation goes through here: one busy flag, one toast pair, one reload. */
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

  return (
    <AdminShell
      title={user?.name ?? "Account"}
      lede={user?.email}
      denied={denied}
      loading={loading}
      action={
        <Link
          href="/dashboard/admin/users"
          className="text-sm text-charcoal/55 hover:text-ink hover:underline"
        >
          ← All users
        </Link>
      }
    >
      {!user ? (
        <EmptyState
          title="No such account"
          description="It may have been deleted, or the id is wrong."
          actionLabel="Back to users"
          actionHref="/dashboard/admin/users"
        />
      ) : (
        <div className="space-y-6">
          {/* Identity */}
          <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-mist bg-white p-5">
            <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-fog">
              {user.avatarUrl && (
                <Image
                  src={user.avatarUrl}
                  alt=""
                  fill
                  sizes="64px"
                  placeholder="blur"
                  blurDataURL={BLUR_DATA_URL}
                  className="object-cover"
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink">{user.name}</h2>
                <StatusBadge
                  tone={ACCOUNT_STATUS_TONE[user.status]}
                  label={ACCOUNT_STATUS_LABELS[user.status]}
                />
                <StatusBadge
                  tone={user.verified ? "done" : "pending"}
                  label={user.verified ? "Email verified" : "Email unverified"}
                />
              </div>
              <p className="mt-1 text-sm text-charcoal/70">
                {user.email}
                {user.phone && ` · ${user.phone}`}
              </p>
              <p className="mt-0.5 font-mono text-xs text-charcoal/50">
                {user.id} · joined {formatDate(user.createdAt)}
                {user.lastLoginAt && ` · last seen ${formatDate(user.lastLoginAt)}`}
              </p>
              <p className="mt-0.5 font-mono text-[10px] uppercase text-charcoal/45">
                signs in with{" "}
                {user.authMethods.length > 0
                  ? user.authMethods.join(" · ")
                  : "nothing (reset link only)"}
              </p>
            </div>
          </div>

          {user.status === "suspended" && user.suspendedReason && (
            <p className="rounded-xl border border-leash/30 bg-leash/5 px-4 py-3 text-sm text-charcoal">
              <strong className="font-medium">Suspended</strong>
              {user.suspendedAt && ` on ${formatDate(user.suspendedAt)}`} —{" "}
              {user.suspendedReason}
            </p>
          )}

          {/* Activity */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Pets" value={String(user.counts.pets)} />
            <Stat label="Bookings" value={String(user.counts.bookings)} />
            <Stat label="Appointments" value={String(user.counts.appointments)} />
            <Stat label="Orders" value={String(user.counts.orders)} />
            <Stat label="Unread" value={String(user.counts.unreadNotifications)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Marketplace roles */}
            <Panel title="Marketplace roles">
              <p className="mb-3 text-xs text-charcoal/60">
                What this account does on Leash. Customers choose these
                themselves during onboarding; changing them here is for fixing
                mistakes.
              </p>
              <ToggleChips
                label={(r) => ROLE_LABELS[r]}
                size="sm"
                options={ROLE_OPTIONS}
                selected={user.roles}
                onToggle={(r: UserRole) =>
                  run("Roles updated", () =>
                    setUserRoles(id, toggleValue(user.roles, r))
                  )
                }
              />
            </Panel>

            {/* Staff access */}
            <Panel title="Staff access">
              {!canAdmin ? (
                <p className="text-sm text-charcoal/55">
                  Only an administrator can change staff access.
                </p>
              ) : isSelf ? (
                <p className="text-sm text-charcoal/55">
                  You can&apos;t change your own staff access. Ask another
                  administrator.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-xs text-charcoal/60">
                    What this account may do <em>to</em> Leash. An administrator
                    holds every one of these implicitly.
                  </p>
                  <ToggleChips
                    label={(r) => STAFF_ROLE_LABELS[r]}
                    size="sm"
                    options={STAFF_ROLE_OPTIONS}
                    selected={user.staffRoles}
                    onToggle={(r: StaffRole) =>
                      run("Staff access updated", () =>
                        setStaffRoles(id, toggleValue(user.staffRoles, r))
                      )
                    }
                  />
                </>
              )}
            </Panel>

            {/* Professional profiles */}
            {(user.caretakerProfile || user.vetProfile) && (
              <Panel title="Professional profile">
                {user.caretakerProfile && (
                  <p className="text-sm text-charcoal/70">
                    Caretaker · background check{" "}
                    <strong className="font-medium text-ink">
                      {user.caretakerProfile.backgroundCheckStatus}
                    </strong>{" "}
                    · {user.caretakerProfile.rating.toFixed(1)}★ from{" "}
                    {user.caretakerProfile.reviewCount} reviews
                  </p>
                )}
                {user.vetProfile && (
                  <p className="mt-1 text-sm text-charcoal/70">
                    Vet · {user.vetProfile.clinicName} · licence{" "}
                    <span className="font-mono">
                      {user.vetProfile.licenseNumber || "—"}
                    </span>{" "}
                    ({user.vetProfile.licenseState || "—"})
                  </p>
                )}
              </Panel>
            )}

            {/* Recent orders */}
            <Panel title="Recent orders">
              {user.recentOrders.length === 0 ? (
                <p className="text-sm text-charcoal/55">No orders yet.</p>
              ) : (
                <ul className="space-y-2">
                  {user.recentOrders.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/store/orders/${o.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-mist px-3 py-2 transition-colors hover:border-ink/40"
                      >
                        <span className="font-mono text-xs text-ink">{o.id}</span>
                        <span className="text-xs capitalize text-charcoal/60">
                          {o.status.replace(/_/g, " ")} · {o.paymentStatus}
                        </span>
                        <span className="font-mono text-xs text-ink">
                          {formatCents(o.totalCents)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Actions */}
          <Panel title="Account actions">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    user.verified ? "Marked unverified" : "Marked verified",
                    () => setUserVerified(id, !user.verified)
                  )
                }
              >
                {user.verified ? "Mark unverified" : "Mark verified"}
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busy || isSelf}
                onClick={() =>
                  run("Signed out everywhere", () => signOutUser(id))
                }
              >
                Sign out everywhere
              </Button>

              {user.status === "suspended" ? (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy}
                  onClick={() => run("Account reactivated", () => reactivateUser(id))}
                >
                  Reactivate
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || isSelf}
                  onClick={() => {
                    const reason = window.prompt(
                      "Why is this account being suspended? The reason is recorded in the audit log."
                    );
                    if (!reason || reason.trim().length < 3) return;
                    run("Account suspended", () => suspendUser(id, reason.trim()));
                  }}
                >
                  Suspend
                </Button>
              )}

              {canAdmin && user.status !== "deleted" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || isSelf}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete ${user.email}?\n\nTheir name, email, phone and address are erased and they can no longer sign in. Their orders, payments and reviews stay, attributed to a deleted account — those are financial and reputational records, and other people's reviews depend on them.\n\nThis cannot be undone.`
                      )
                    )
                      return;
                    run("Account deleted", () => deleteUser(id));
                  }}
                  className="text-leash hover:text-leash-hover"
                >
                  Delete account
                </Button>
              )}
            </div>

            {isSelf && (
              <p className="mt-3 text-xs text-charcoal/55">
                Some actions are disabled because this is your own account.
              </p>
            )}
          </Panel>
        </div>
      )}
    </AdminShell>
  );
}
