"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { StaffRole } from "@/types";
import { useSession } from "@/lib/store/session";
import { AuthRequired } from "@/components/AuthRequired";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/**
 * The frame every admin page sits in: the guard ladder, the section nav, and
 * the page heading.
 *
 * The ladder is the same one /dashboard/orders has always used — skeleton while
 * the session hydrates, `AuthRequired` when signed out, an explanation when the
 * server says no — and it is here rather than copied into ten pages because a
 * guard that is written ten times is a guard that is eventually written wrong.
 *
 * Note what this component does *not* do: it does not decide access. It renders
 * what the server already decided, either from `staffRoles` on the session user
 * (which the server put there) or from the 403 a page hands back. Every admin
 * endpoint re-checks with `requireStaff`, so hiding a tab here is tidiness, not
 * security.
 */

const SECTIONS: { href: string; label: string; role: StaffRole }[] = [
  { href: "/dashboard/admin", label: "Overview", role: "support" },
  { href: "/dashboard/admin/users", label: "Users", role: "support" },
  { href: "/dashboard/admin/professionals", label: "Professionals", role: "support" },
  { href: "/dashboard/admin/payments", label: "Payments", role: "finance" },
  { href: "/dashboard/admin/subscriptions", label: "Memberships", role: "finance" },
  { href: "/dashboard/orders", label: "Fulfilment", role: "ops" },
  { href: "/dashboard/admin/audit", label: "Audit", role: "admin" },
  { href: "/dashboard/admin/settings", label: "Settings", role: "admin" },
];

export function holdsRole(held: StaffRole[] | undefined, role: StaffRole): boolean {
  if (!held) return false;
  return held.includes("admin") || held.includes(role);
}

export function AdminShell({
  title,
  lede,
  /** Rendered opposite the heading — a filter, a primary action. */
  action,
  /** Set by a page that got a 403 from its own endpoint. */
  denied,
  loading,
  children,
}: {
  title: string;
  lede?: string;
  action?: ReactNode;
  denied?: boolean;
  loading?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { currentUser, hasHydrated } = useSession();

  if (!hasHydrated) {
    return (
      <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-6 h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!currentUser) {
    return <AuthRequired message="Log in to reach the admin console." />;
  }

  const held = currentUser.staffRoles;
  const isStaff = (held?.length ?? 0) > 0;

  if (!isStaff || denied) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Staff only"
          description="This is the internal console for running Leash. Your account doesn't have access to it."
          actionLabel="Back to dashboard"
          actionHref="/dashboard"
        />
      </div>
    );
  }

  const visible = SECTIONS.filter((s) => holdsRole(held, s.role));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <p className="font-mono text-xs uppercase tracking-widest text-leash">
        Administration
      </p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {lede && <p className="mt-1 text-sm text-charcoal/70">{lede}</p>}
        </div>
        {action}
      </div>

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-mist pb-px">
        {visible.map((s) => {
          const current =
            s.href === "/dashboard/admin"
              ? pathname === s.href
              : pathname === s.href || pathname.startsWith(`${s.href}/`);
          return (
            <Link
              key={s.href}
              href={s.href}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm transition-colors",
                current
                  ? "border-b-2 border-ink font-medium text-ink"
                  : "border-b-2 border-transparent text-charcoal/60 hover:text-ink"
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
